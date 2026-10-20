import { purchaseRequestsService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../lib/api";

// POST /api/v1/purchases/requests/:requestId/decision { decision: "approve" |
// "reject", note? (required to reject) } → { requestId, status }. Admins only.

type Params = { params: Promise<{ requestId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { requestId } = await params;
  return withContext(request, async (ctx) => purchaseRequestsService.decideRequest(ctx, requestId, await readJson(request)));
}
