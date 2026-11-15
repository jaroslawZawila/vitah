import { parsePhotoSize, warrantyService } from "@repo/core";
import { fileResponse, withContext } from "../../../../../../../../../lib/api";

// GET /api/v1/projects/:id/warranty/:claimId/photos/:photoId → the image the
// client sent; ?size=thumb → a WebP of at most 800 px, for grids.

type Params = { params: Promise<{ id: string; claimId: string; photoId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, claimId, photoId } = await params;
  const size = parsePhotoSize(new URL(request.url).searchParams.get("size"));
  return withContext(request, async (ctx) =>
    fileResponse(await warrantyService.openClaimPhoto(ctx, id, claimId, photoId, size), { immutable: true }),
  );
}
