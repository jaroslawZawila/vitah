import { purchaseRequestsService } from "@repo/core";
import { readJson, withContext } from "../../../../../../lib/api";

// ─── /api/v1/purchases/requests/:requestId ────────────────────────────────────
// GET → PurchaseRequestDetail
// PATCH any of { kind, description, neededBy, subcontractorId, notes, lines },
//   while pending → { requestId }
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ requestId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { requestId } = await params;
  return withContext(request, (ctx) => purchaseRequestsService.getRequest(ctx, requestId));
}

export async function PATCH(request: Request, { params }: Params) {
  const { requestId } = await params;
  return withContext(request, async (ctx) => purchaseRequestsService.updateRequest(ctx, requestId, await readJson(request)));
}
