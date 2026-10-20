import { and, asc, db, desc, eq, purchaseOrderDocumentVersions, purchaseOrderDocuments, purchaseOrders, sql } from "@repo/db";
import { requireEditor, type Ctx } from "./context";
import { requirePdf } from "./documents";
import { fail, optionalText, requiredText } from "./obra-data";
import { openStoredFile, projectFolder, storeFiles, uploadedName, type StoredFile } from "./project-files";
import { logEvent, requireOrder } from "./purchasing";
import { deleteFile } from "./storage";

// ─── An order's documents (Compras) ──────────────────────────────────────────
// The order, its signed contract, annexes, the supplier's offer…: each a PDF
// in versions. A new upload adds a version (with why it replaced the last);
// the newest is current and none is overwritten. A document can be removed
// with all its versions. Invoices keep their own PDFs (./purchase-invoices).
// Admins and managers upload and remove; every staff member downloads.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_TITLE = 200;
const MAX_NOTE = 300;

type OrderRow = Awaited<ReturnType<typeof requireOrder>>;

/** The order's document; `not_found` otherwise. */
async function requireDocument(ctx: Ctx, order: OrderRow, documentId: string) {
  const document = await db.query.purchaseOrderDocuments.findFirst({
    where: and(
      eq(purchaseOrderDocuments.id, documentId),
      eq(purchaseOrderDocuments.orderId, order.id),
      eq(purchaseOrderDocuments.tenantId, ctx.tenantId),
    ),
  });
  if (!document) fail("not_found");
  return document;
}

/** The order's first document, if any (what its single PDF used to be). */
const firstDocument = (ctx: Ctx, orderId: string) =>
  db.query.purchaseOrderDocuments.findFirst({
    where: and(eq(purchaseOrderDocuments.orderId, orderId), eq(purchaseOrderDocuments.tenantId, ctx.tenantId)),
    orderBy: [asc(purchaseOrderDocuments.createdAt), asc(purchaseOrderDocuments.id)],
  });

const documentFolder = (ctx: Ctx, order: OrderRow, documentId: string) =>
  `${projectFolder(ctx.tenantId, order.projectId)}purchases/${order.id}/documents/${documentId}/`;

/** Stores `file` as the document's next version (retried if two land at once). → its number. */
async function addVersion(ctx: Ctx, order: OrderRow, document: { id: string; title: string }, file: Blob, note: string | null, created: boolean) {
  const pathname = `${documentFolder(ctx, order, document.id)}${crypto.randomUUID()}.pdf`;
  const filename = uploadedName(file, `${document.title}.pdf`);
  let version = 0;
  await storeFiles([{ pathname, body: file, contentType: "application/pdf" }], async () => {
    for (let attempt = 0; attempt < 5 && version === 0; attempt++) {
      version = await db.transaction(async (tx) => {
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
            .where(eq(purchaseOrderDocuments.id, document.id))
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
      });
    }
    if (version === 0) throw new Error("Could not version the order's document");
  });
  return version;
}

/** Body: { title, file (PDF), note? }: a new document of the order. → { documentId, version } */
export async function addOrderDocument(ctx: Ctx, orderId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const order = await requireOrder(ctx, orderId);
  const title = requiredText(input.title, MAX_TITLE);
  const file = await requirePdf(input.file);
  const note = optionalText(input.note, MAX_NOTE);
  const documentId = crypto.randomUUID();
  const version = await addVersion(ctx, order, { id: documentId, title }, file, note, true);
  return { documentId, version };
}

/** Body: { file (PDF), note? (why it replaces the last) }: the document's next version. → { documentId, version } */
export async function addOrderDocumentVersion(ctx: Ctx, orderId: string, documentId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const order = await requireOrder(ctx, orderId);
  const document = await requireDocument(ctx, order, documentId);
  const file = await requirePdf(input.file);
  const note = optionalText(input.note, MAX_NOTE);
  const version = await addVersion(ctx, order, document, file, note, false);
  return { documentId, version };
}

/** Removes a document with all its versions. */
export async function deleteOrderDocument(ctx: Ctx, orderId: string, documentId: string) {
  requireEditor(ctx);
  const order = await requireOrder(ctx, orderId);
  const document = await requireDocument(ctx, order, documentId);
  const pathnames = await db.transaction(async (tx) => {
    // Locked first: no version can land between reading its files and the delete.
    const [locked] = await tx
      .select({ id: purchaseOrderDocuments.id })
      .from(purchaseOrderDocuments)
      .where(eq(purchaseOrderDocuments.id, documentId))
      .for("update");
    if (!locked) fail("not_found");
    const versions = await tx
      .select({ pathname: purchaseOrderDocumentVersions.pathname })
      .from(purchaseOrderDocumentVersions)
      .where(eq(purchaseOrderDocumentVersions.documentId, documentId));
    const pathnames = versions.map((v) => v.pathname);
    await tx.delete(purchaseOrderDocuments).where(eq(purchaseOrderDocuments.id, documentId));
    // The legacy single PDF it came from goes too, so a re-run of the migration can't bring it back.
    if (order.filePathname && pathnames.includes(order.filePathname)) {
      await tx.update(purchaseOrders).set({ fileName: null, filePathname: null, fileSizeBytes: null }).where(eq(purchaseOrders.id, order.id));
    }
    await logEvent(tx, ctx, order.id, "document_removed", { documentId, title: document.title, versions: pathnames.length });
    return pathnames;
  });
  // The files go once the rows are gone, so a refused delete never loses one.
  await Promise.all(pathnames.map((p) => deleteFile(p).catch(() => {})));
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
