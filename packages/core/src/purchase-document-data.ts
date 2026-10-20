import { and, asc, db, desc, eq, inArray, purchaseOrderDocumentVersions, purchaseOrderDocuments, users } from "@repo/db";
import type { PurchaseOrderDocument } from "./contract";
import { groupBy, userName } from "./obra-data";

// ─── An order's documents: loading ───────────────────────────────────────────
// What the order's page and the lists read of ./purchase-documents.
// ─────────────────────────────────────────────────────────────────────────────

/** The orders' documents with their versions (newest first), oldest document first, by order. */
export async function loadDocuments(tenantId: string, orderIds: string[]) {
  if (orderIds.length === 0) return new Map<string, PurchaseOrderDocument[]>();
  const [documents, versions] = await Promise.all([
    db
      .select()
      .from(purchaseOrderDocuments)
      .where(and(eq(purchaseOrderDocuments.tenantId, tenantId), inArray(purchaseOrderDocuments.orderId, orderIds)))
      .orderBy(asc(purchaseOrderDocuments.createdAt), asc(purchaseOrderDocuments.id)),
    db
      .select({ version: purchaseOrderDocumentVersions, by: userName })
      .from(purchaseOrderDocumentVersions)
      .innerJoin(purchaseOrderDocuments, eq(purchaseOrderDocuments.id, purchaseOrderDocumentVersions.documentId))
      .leftJoin(users, eq(users.id, purchaseOrderDocumentVersions.uploadedById))
      .where(and(eq(purchaseOrderDocumentVersions.tenantId, tenantId), inArray(purchaseOrderDocuments.orderId, orderIds)))
      .orderBy(desc(purchaseOrderDocumentVersions.version)),
  ]);
  const byDocument = groupBy(versions, (v) => v.version.documentId);
  const byOrder = new Map<string, PurchaseOrderDocument[]>();
  for (const d of documents) {
    const list = byOrder.get(d.orderId) ?? [];
    list.push({
      id: d.id,
      title: d.title,
      versions: (byDocument.get(d.id) ?? []).map(({ version: v, by }) => ({
        id: v.id,
        version: v.version,
        filename: v.filename,
        sizeBytes: v.sizeBytes,
        note: v.note,
        by,
        at: v.createdAt.toISOString(),
      })),
      createdAt: d.createdAt.toISOString(),
    });
    byOrder.set(d.orderId, list);
  }
  return byOrder;
}

/** Which of the orders have documents. */
export async function ordersWithDocuments(tenantId: string, orderIds: string[]) {
  if (orderIds.length === 0) return new Set<string>();
  const rows = await db
    .selectDistinct({ orderId: purchaseOrderDocuments.orderId })
    .from(purchaseOrderDocuments)
    .where(and(eq(purchaseOrderDocuments.tenantId, tenantId), inArray(purchaseOrderDocuments.orderId, orderIds)));
  return new Set(rows.map((r) => r.orderId));
}

