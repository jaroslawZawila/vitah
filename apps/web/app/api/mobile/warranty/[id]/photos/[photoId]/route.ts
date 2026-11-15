import { parsePhotoSize, warrantyService } from "@repo/core";
import { fileResponse, withMobileClient } from "../../../../../../../lib/api";

// GET /api/mobile/warranty/:id/photos/:photoId → the image of one of the
// client's own claims; ?size=thumb → a WebP of at most 800 px. 404 otherwise.

type Params = { params: Promise<{ id: string; photoId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, photoId } = await params;
  const size = parsePhotoSize(new URL(request.url).searchParams.get("size"));
  return withMobileClient(request, async (client) =>
    fileResponse(await warrantyService.openClientClaimPhoto(client.tenantId, client.sub, id, photoId, size), {
      immutable: true,
    }),
  );
}
