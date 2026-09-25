import { documentsService } from "@repo/core";
import { fileResponse, withContext } from "../../../../../../../lib/api";

// ─── /api/v1/projects/:id/documents/:documentId ───────────────────────────────
// GET    → the PDF itself (application/pdf)
// DELETE → 204
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string; documentId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, documentId } = await params;
  return withContext(request, async (ctx) =>
    fileResponse(await documentsService.openDocument(ctx, id, documentId)),
  );
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, documentId } = await params;
  return withContext(
    request,
    (ctx) => documentsService.deleteDocument(ctx, id, documentId),
    204,
  );
}
