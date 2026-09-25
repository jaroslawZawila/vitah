import { photosService } from "@repo/core";
import { fileResponse, withContext } from "../../../../../../../lib/api";

// ─── /api/v1/projects/:id/photos/:photoId ─────────────────────────────────────
// GET    → the image itself (image/jpeg, image/png or image/webp)
// DELETE → 204
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string; photoId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, photoId } = await params;
  return withContext(request, async (ctx) =>
    fileResponse(await photosService.openPhoto(ctx, id, photoId), { immutable: true }),
  );
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, photoId } = await params;
  return withContext(request, (ctx) => photosService.deletePhoto(ctx, id, photoId), 204);
}
