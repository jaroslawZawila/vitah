import { warrantyService } from "@repo/core";
import { withMobileClient } from "../../../../../lib/api";

// GET /api/mobile/warranty/:id → MobileWarrantyClaim: one of the client's own
// claims, with its photos' ids and its history; 404 for anyone else's.

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withMobileClient(request, (client) => warrantyService.getClientClaim(client.tenantId, client.sub, id));
}
