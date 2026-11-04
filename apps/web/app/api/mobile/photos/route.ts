import { photosService } from "@repo/core";
import { projectParam, withMobileClient } from "../../../../lib/api";

// ─── GET /api/mobile/photos ───────────────────────────────────────────────────
// Site photos of the signed-in client's project (`?projectId=`, else the
// default one), newest first: { photos: MobilePhoto[] }. Empty when no project
// is attached. Requires `Authorization: Bearer <token>`.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  return withMobileClient(request, async (client) => ({
    photos: await photosService.listClientPhotos(client.tenantId, client.sub, projectParam(request)),
  }));
}
