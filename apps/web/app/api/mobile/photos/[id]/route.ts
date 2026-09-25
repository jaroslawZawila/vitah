import { parsePhotoSize, photosService } from "@repo/core";
import { fileResponse, withMobileClient } from "../../../../../lib/api";

// ─── GET /api/mobile/photos/:id ───────────────────────────────────────────────
// The image, if it belongs to the signed-in client's project; 404 otherwise.
// ?size=thumb → a WebP of at most 800 px, for grids.
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const size = parsePhotoSize(new URL(request.url).searchParams.get("size"));
  return withMobileClient(request, async (client) =>
    fileResponse(
      await photosService.openClientPhoto(client.tenantId, client.sub, id, size),
      { immutable: true },
    ),
  );
}
