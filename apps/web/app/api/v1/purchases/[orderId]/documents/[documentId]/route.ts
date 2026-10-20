import { purchaseDocumentsService } from "@repo/core";
import { fileResponse, readForm, withContext } from "../../../../../../../lib/api";

// ─── /api/v1/purchases/:orderId/documents/:documentId ─────────────────────────
// GET (?versionId: an older one) → the document's PDF, its current version
// POST multipart { file (PDF ≤ 4 MB), note? } → { documentId, version }: its next version
// DELETE → { documentId }: the document with all its versions
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ orderId: string; documentId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { orderId, documentId } = await params;
  const versionId = new URL(request.url).searchParams.get("versionId") ?? undefined;
  return withContext(request, async (ctx) =>
    fileResponse(await purchaseDocumentsService.openOrderDocument(ctx, orderId, documentId, versionId)),
  );
}

export async function POST(request: Request, { params }: Params) {
  const { orderId, documentId } = await params;
  return withContext(
    request,
    async (ctx) => purchaseDocumentsService.addOrderDocumentVersion(ctx, orderId, documentId, await readForm(request)),
    201,
  );
}

export async function DELETE(request: Request, { params }: Params) {
  const { orderId, documentId } = await params;
  return withContext(request, (ctx) => purchaseDocumentsService.deleteOrderDocument(ctx, orderId, documentId));
}
