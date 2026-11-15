import { and, asc, db, desc, eq, isNull, purchaseOrderDocumentVersions, purchaseOrderDocuments, sql } from "@repo/db";
import { requireEditor, type Ctx } from "./context";
import { requirePdf } from "./documents";
import { idempotent, type Once } from "./idempotency";
import { parse } from "./inputs/fields";
import { orderDocumentSchema, orderDocumentVersionSchema } from "./inputs/purchase-documents";
import { fail } from "./obra-data";
import { softDeleted } from "./project-client";
import { openStoredFile, projectFolder, storeFiles, uploadedName, type StoredFile } from "./project-files";
import { logEvent, requireOrder } from "./purchasing";

// ─── An order's documents (Compras) ──────────────────────────────────────────
// The order, its signed contract, annexes, the supplier's offer…: each a PDF
// in versions. A new upload adds a version (with why it replaced the last);
// the newest is current and none is overwritten. A document can be removed
// with all its versions: a soft delete (`deleted_at`), so its row, versions
// and files stay and every read leaves it out. Invoices keep their own PDFs
// (./purchase-invoices). Admins and managers upload and remove; every staff
// member downloads.
// ─────────────────────────────────────────────────────────────────────────────

type OrderRow = Awaited<ReturnType<typeof requireOrder>>;

/** The order's document, unless removed; `not_found` otherwise. */
async function requireDocument(ctx: Ctx, order: OrderRow, documentId: string) {
  const document = await db.query.purchaseOrderDocuments.findFirst({
    where: and(
      eq(purchaseOrderDocuments.id, documentId),
      eq(purchaseOrderDocuments.orderId, order.id),
      eq(purchaseOrderDocuments.tenantId, ctx.tenantId),
      isNull(purchaseOrderDocuments.deletedAt),
    ),
  });
  if (!document) fail("not_found");
  return document;
}

/** The order's first document not removed, if any (what its single PDF used to be). */
const firstDocument = (ctx: Ctx, orderId: string) =>
  db.query.purchaseOrderDocuments.findFirst({
    where: and(
      eq(purchaseOrderDocuments.orderId, orderId),
      eq(purchaseOrderDocuments.tenantId, ctx.tenantId),
      isNull(purchaseOrderDocuments.deletedAt),
    ),
    orderBy: [asc(purchaseOrderDocuments.createdAt), asc(purchaseOrderDocuments.id)],
  });

const documentFolder = (ctx: Ctx, order: OrderRow, documentId: string) =>
  `${projectFolder(ctx.tenantId, order.projectId)}purchases/${order.id}/documents/${documentId}/`;

/**
 * Stores `file` as the document's next version (retried if two land at once). → its number.
 * `once` makes a new document once per idempotency key (addOrderDocument).
 */
async function addVersion(
  ctx: Ctx,
  order: OrderRow,
  document: { id: string; title: string },
  file: Blob,
  note: string | null,
  created: boolean,
  once: Once<number> = (_tx, add) => add(),
) {
  const pathname = `${documentFolder(ctx, order, document.id)}${crypto.randomUUID()}.pdf`;
  const filename = uploadedName(file, `${document.title}.pdf`);
  let version = 0;
  await storeFiles([{ pathname, body: file, contentType: "application/pdf" }], async () => {
    for (let attempt = 0; attempt < 5 && version === 0; attempt++) {
      version = await db.transaction((tx) =>
        once(tx, async () => {
          if (created) {
            await tx
              .insert(purchaseOrderDocuments)
              .values({ id: document.id, tenantId: ctx.tenantId, orderId: order.id, title: document.title, createdById: ctx.userId })
              .onConflictDoNothing();
          } else {
            // Shared lock: a removal at the same time waits, or this finds the document gone.
            const [still] = await tx
              .select({ id: purchaseOrderDocuments.id })
              .from(purchaseOrderDocuments)
              .where(and(eq(purchaseOrderDocuments.id, document.id), isNull(purchaseOrderDocuments.deletedAt)))
              .for("share");
            if (!still) fail("not_found");
          }
          const [row] = await tx
            .insert(purchaseOrderDocumentVersions)
            .values({
              tenantId: ctx.tenantId,
              documentId: document.id,
              version: sql`(select coalesce(max(${purchaseOrderDocumentVersions.version}), 0) + 1 from ${purchaseOrderDocumentVersions} where ${purchaseOrderDocumentVersions.documentId} = ${document.id})`,
              pathname,
              filename,
              sizeBytes: file.size,
              note,
              uploadedById: ctx.userId,
            })
            .onConflictDoNothing()
            .returning({ version: purchaseOrderDocumentVersions.version });
          if (!row) return 0;
          await logEvent(
            tx,
            ctx,
            order.id,
            created ? "document_added" : "document_version_added",
            { documentId: document.id, title: document.title, version: row.version, name: filename },
            note,
          );
          return row.version;
        }),
      );
    }
    if (version === 0) throw new Error("Could not version the order's document");
  });
  return version;
}

/**
 * Body: { title, file (PDF), note? }: a new document of the order. → { documentId, version }
 * `idempotencyKey` is the caller's in core (a modificado's signed PDF, attached
 * once however often its request comes: ./purchase-amendments), not the body's.
 */
export async function addOrderDocument(ctx: Ctx, orderId: string, input: Record<string, unknown>, idempotencyKey?: string) {
  requireEditor(ctx);
  return idempotent<{ documentId: string; version: number }>(ctx, "purchase.document.create", { orderId }, { ...input, idempotencyKey }, async (once) => {
    const order = await requireOrder(ctx, orderId);
    // Title, PDF, note: in that order, as always.
    const { title } = parse(orderDocumentSchema.pick({ title: true }), input);
    const file = await requirePdf(input.file);
    const { note } = parse(orderDocumentSchema, input);
    const documentId = crypto.randomUUID();
    // The key is kept with the document and its version (a new document's first version is never taken already: no 0).
    const version = await addVersion(ctx, order, { id: documentId, title }, file, note, true, async (tx, add) => {
      const made = await once(tx, async () => ({ documentId, version: await add() }));
      return made.version;
    });
    return { documentId, version };
  });
}

/** Body: { file (PDF), note? (why it replaces the last) }: the document's next version. → { documentId, version } */
export async function addOrderDocumentVersion(ctx: Ctx, orderId: string, documentId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const order = await requireOrder(ctx, orderId);
  const document = await requireDocument(ctx, order, documentId);
  const file = await requirePdf(input.file);
  const { note } = parse(orderDocumentVersionSchema, input);
  const version = await addVersion(ctx, order, document, file, note, false);
  return { documentId, version };
}

/**
 * Removes a document with all its versions: it leaves the order's page, its
 * row, versions and files stay (a soft delete). Removed already: `not_found`.
 */
export async function deleteOrderDocument(ctx: Ctx, orderId: string, documentId: string) {
  requireEditor(ctx);
  const order = await requireOrder(ctx, orderId);
  const document = await requireDocument(ctx, order, documentId);
  await db.transaction(async (tx) => {
    // The row is locked by the update: a version landing at the same time waits, then finds it removed.
    const [removed] = await tx
      .update(purchaseOrderDocuments)
      .set(softDeleted(ctx))
      .where(and(eq(purchaseOrderDocuments.id, documentId), isNull(purchaseOrderDocuments.deletedAt)))
      .returning({ id: purchaseOrderDocuments.id });
    if (!removed) fail("not_found");
    const versions = await tx
      .select({ id: purchaseOrderDocumentVersions.id })
      .from(purchaseOrderDocumentVersions)
      .where(eq(purchaseOrderDocumentVersions.documentId, documentId));
    await logEvent(tx, ctx, order.id, "document_removed", { documentId, title: document.title, versions: versions.length });
  });
  return { documentId };
}

/** A document's PDF: `versionId`, else its current version. Every staff member may read it. */
export async function openOrderDocument(ctx: Ctx, orderId: string, documentId: string, versionId?: string): Promise<StoredFile> {
  const order = await requireOrder(ctx, orderId);
  await requireDocument(ctx, order, documentId);
  const [version] = await db
    .select()
    .from(purchaseOrderDocumentVersions)
    .where(
      and(
        eq(purchaseOrderDocumentVersions.documentId, documentId),
        versionId ? eq(purchaseOrderDocumentVersions.id, versionId) : undefined,
      ),
    )
    .orderBy(desc(purchaseOrderDocumentVersions.version))
    .limit(1);
  if (!version) fail("not_found");
  return openStoredFile({ filename: version.filename, contentType: "application/pdf", sizeBytes: version.sizeBytes, pathname: version.pathname });
}

// ─── The single PDF an order had (GET/POST/DELETE /api/v1/purchases/:orderId/file) ──
// Kept for older clients: it is the order's first document.

/** The first document's current version. */
export async function openPurchaseFile(ctx: Ctx, orderId: string): Promise<StoredFile> {
  await requireOrder(ctx, orderId);
  const first = await firstDocument(ctx, orderId);
  if (!first) fail("not_found");
  return openOrderDocument(ctx, orderId, first.id);
}

/** Body: { file } (PDF): a new version of the first document, or the first document (named after the file). */
export async function uploadPurchaseFile(ctx: Ctx, orderId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const order = await requireOrder(ctx, orderId);
  const file = await requirePdf(input.file);
  const first = await firstDocument(ctx, orderId);
  if (first) await addVersion(ctx, order, first, file, null, false);
  else {
    const title = uploadedName(file, "pedido.pdf").replace(/\.pdf$/i, "") || "pedido";
    await addVersion(ctx, order, { id: crypto.randomUUID(), title }, file, null, true);
  }
  return { orderId };
}

/** Removes the first document. */
export async function deletePurchaseFile(ctx: Ctx, orderId: string) {
  requireEditor(ctx);
  await requireOrder(ctx, orderId);
  const first = await firstDocument(ctx, orderId);
  if (!first) fail("not_found");
  await deleteOrderDocument(ctx, orderId, first.id);
  return { orderId };
}
