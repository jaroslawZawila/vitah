import { and, db, desc, eq, purchaseOrderAmendments, purchaseOrderDocuments, users } from "@repo/db";
import type { PurchaseOrderAmendment } from "./contract";
import { userName } from "./obra-data";

// Loading an order's modifications: read by ./purchasing (the order's page)
// and written by ./purchase-amendments.

/** The order's modifications, newest first, with their PDF's title and who recorded them. */
export async function loadAmendments(tenantId: string, orderId: string): Promise<PurchaseOrderAmendment[]> {
  const rows = await db
    .select({ amendment: purchaseOrderAmendments, documentTitle: purchaseOrderDocuments.title, by: userName })
    .from(purchaseOrderAmendments)
    .leftJoin(purchaseOrderDocuments, eq(purchaseOrderDocuments.id, purchaseOrderAmendments.documentId))
    .leftJoin(users, eq(users.id, purchaseOrderAmendments.createdById))
    .where(and(eq(purchaseOrderAmendments.tenantId, tenantId), eq(purchaseOrderAmendments.orderId, orderId)))
    .orderBy(desc(purchaseOrderAmendments.number));
  return rows.map(({ amendment: a, documentTitle, by }) => ({
    id: a.id,
    number: a.number,
    concept: a.concept,
    signedOn: a.signedOn,
    amountBeforeCents: a.amountBeforeCents,
    amountAfterCents: a.amountAfterCents,
    changes: a.changes as PurchaseOrderAmendment["changes"],
    document: a.documentId && documentTitle !== null ? { id: a.documentId, title: documentTitle } : null,
    by,
    at: a.createdAt.toISOString(),
  }));
}
