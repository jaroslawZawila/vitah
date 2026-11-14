import { and, db, desc, eq, purchaseDocumentChecks, sql, users, type SQL } from "@repo/db";
import type { DocumentFinding, PurchaseDocumentCheck } from "./contract";
import { userName } from "./obra-data";
import { inLiveOrder } from "./project-client";

// Loading the AI's review of purchase documents: read by ./purchasing (an
// order's page) and ./purchase-invoices (an invoice's), written by
// ./purchase-document-checks.

export type CheckRow = typeof purchaseDocumentChecks.$inferSelect;

/**
 * Soft delete: a check stays with its file when a user deletes the order
 * document, the invoice or the payment it reviewed, or its obra. Such a check
 * is left out of every read, the queue and the search for the same file
 * uploaded before. Raw SQL, so it also goes inside `claim`'s statement.
 */
export const liveCheck = sql`(
  (${purchaseDocumentChecks.documentVersionId} is null or exists (
    select 1 from purchase_order_document_versions v join purchase_order_documents d on d.id = v.document_id
    where v.id = ${purchaseDocumentChecks.documentVersionId} and d.deleted_at is null))
  and (${purchaseDocumentChecks.invoiceFileId} is null or exists (
    select 1 from purchase_invoice_files f join purchase_invoices i on i.id = f.invoice_id
    where f.id = ${purchaseDocumentChecks.invoiceFileId} and i.deleted_at is null))
  and (${purchaseDocumentChecks.paymentId} is null or exists (
    select 1 from purchase_payments p join purchase_invoices i on i.id = p.invoice_id
    where p.id = ${purchaseDocumentChecks.paymentId} and p.deleted_at is null and i.deleted_at is null))
  and ${inLiveOrder(purchaseDocumentChecks.orderId)}
)`;

export const subjectOf = (row: Pick<CheckRow, "documentVersionId" | "invoiceFileId">): PurchaseDocumentCheck["subject"] =>
  row.documentVersionId ? "order_document" : row.invoiceFileId ? "invoice_file" : "payment_proof";

/** The tenant's checks matching `where` (those of deleted records aside), newest first. */
export async function loadChecks(tenantId: string, where: SQL): Promise<PurchaseDocumentCheck[]> {
  const rows = await db
    .select({ check: purchaseDocumentChecks, dismissedBy: userName })
    .from(purchaseDocumentChecks)
    .leftJoin(users, eq(users.id, purchaseDocumentChecks.dismissedById))
    .where(and(eq(purchaseDocumentChecks.tenantId, tenantId), liveCheck, where))
    .orderBy(desc(purchaseDocumentChecks.createdAt));
  return rows.map(({ check: c, dismissedBy }) => ({
    id: c.id,
    subject: subjectOf(c),
    label: c.label,
    status: c.status,
    findings: c.findings as DocumentFinding[],
    reason: c.reason === "ai_limit" ? "ai_limit" : null,
    checkedAt: c.checkedAt?.toISOString() ?? null,
    dismissedAt: c.dismissedAt?.toISOString() ?? null,
    dismissedBy: c.dismissedAt ? dismissedBy : null,
  }));
}
