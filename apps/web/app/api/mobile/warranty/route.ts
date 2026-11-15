import { warrantyService } from "@repo/core";
import { projectParam, readCreate, withMobileClient } from "../../../../lib/api";

// ─── /api/mobile/warranty ─────────────────────────────────────────────────────
// The Garantía screen of the signed-in client's home (`?projectId=`, else the
// default one). Requires `Authorization: Bearer <token>`.
// GET  → { warranty: MobileWarranty | null }: the hand-over, the three LOE
//        periods and the client's claims, newest first; null without a home.
// POST { kind, room, description, urgent? } → { claimId, number }: a new
//        claim, once the home is handed over. Sent again with the same
//        `Idempotency-Key` header it is one claim, answered the same. Then
//        each photo: POST /api/mobile/warranty/:id/photos.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  return withMobileClient(request, async (client) => ({
    warranty: await warrantyService.getClientWarranty(client.tenantId, client.sub, projectParam(request)),
  }));
}

export async function POST(request: Request) {
  return withMobileClient(request, async (client) =>
    warrantyService.createClientClaim(client.tenantId, client.sub, projectParam(request), await readCreate(request)),
  );
}
