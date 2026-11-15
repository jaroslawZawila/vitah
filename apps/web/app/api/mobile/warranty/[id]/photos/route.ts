import { warrantyService } from "@repo/core";
import { readCreate, readForm, withMobileClient } from "../../../../../../lib/api";

// POST /api/mobile/warranty/:id/photos (multipart: `file`) → { photoId }: a
// photo of the client's claim (JPEG, PNG or WebP, ≤ 4 MB; four per claim), while
// nobody has started on it. One request per photo, each under Vercel's 4.5 MB
// body. Sent again with the same `Idempotency-Key` header it is one photo.

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withMobileClient(request, async (client) =>
    warrantyService.addClientClaimPhoto(client.tenantId, client.sub, id, await readCreate(request, readForm)),
  );
}
