import { warrantyService } from "@repo/core";
import { withMobileClient } from "../../../../../../lib/api";

// POST /api/mobile/warranty/:id/cancel → { claimId }: the client cancels their
// claim while nobody has started on it (409 `claim_closed` after). Sent again,
// it answers the same.

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withMobileClient(request, (client) => warrantyService.cancelClientClaim(client.tenantId, client.sub, id));
}
