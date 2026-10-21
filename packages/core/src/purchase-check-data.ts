import { and, db, desc, eq, purchaseDocumentChecks, users, type SQL } from "@repo/db";
import type { DocumentFinding, PurchaseDocumentCheck } from "./contract";
import { userName } from "./obra-data";

// Loading the AI's review of purchase documents: read by ./purchasing (an
// order's page) and ./purchase-invoices (an invoice's), written by
// ./purchase-document-checks.

export type CheckRow = typeof purchaseDocumentChecks.$inferSelect;

export const subjectOf = (row: Pick<CheckRow, "documentVersionId" | "invoiceFileId">): PurchaseDocumentCheck["subject"] =>
  row.documentVersionId ? "order_document" : row.invoiceFileId ? "invoice_file" : "payment_proof";

/** The tenant's checks matching `where`, newest first. */
export async function loadChecks(tenantId: string, where: SQL): Promise<PurchaseDocumentCheck[]> {
  const rows = await db
    .select({ check: purchaseDocumentChecks, dismissedBy: userName })
    .from(purchaseDocumentChecks)
    .leftJoin(users, eq(users.id, purchaseDocumentChecks.dismissedById))
    .where(and(eq(purchaseDocumentChecks.tenantId, tenantId), where))
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
