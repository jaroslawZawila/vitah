import { purchaseRequestsService } from "@repo/core";
import { readOptionalJson, withContext } from "../../../../../../../lib/api";

// POST /api/v1/purchases/requests/:requestId/cancel { note? } → { requestId }:
// withdraws a request not ordered yet.

type Params = { params: Promise<{ requestId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { requestId } = await params;
  return withContext(request, async (ctx) => purchaseRequestsService.cancelRequest(ctx, requestId, await readOptionalJson(request)));
}
