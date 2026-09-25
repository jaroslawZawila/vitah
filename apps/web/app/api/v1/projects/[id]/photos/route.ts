import { photosService } from "@repo/core";
import { readForm, withContext } from "../../../../../../lib/api";

// ─── /api/v1/projects/:id/photos ──────────────────────────────────────────────
// GET  → ProjectPhoto[]
// POST → multipart form { file (JPEG/PNG/WebP, ≤ 4 MB), caption? } → { photoId }
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => photosService.listPhotos(ctx, id));
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(
    request,
    async (ctx) => photosService.addPhoto(ctx, id, await readForm(request)),
    201,
  );
}
