import { documentsService } from "@repo/core";
import { fileResponse, readJson, withContext } from "../../../../../../../lib/api";

// ─── /api/v1/projects/:id/documents/:documentId ───────────────────────────────
// GET    → the file itself (a PDF, or a budget input's BC3/spreadsheet)
// PATCH  { visibleToClient } → whether the client sees it in the app
// DELETE → 204
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string; documentId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, documentId } = await params;
  return withContext(request, async (ctx) =>
    fileResponse(await documentsService.openDocument(ctx, id, documentId)),
  );
}

export async function PATCH(request: Request, { params }: Params) {
  const { id, documentId } = await params;
  return withContext(request, async (ctx) =>
    documentsService.setDocumentVisibility(ctx, id, documentId, await readJson(request)),
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
