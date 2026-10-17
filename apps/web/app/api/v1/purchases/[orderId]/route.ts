import { purchasingService } from "@repo/core";
import { readJson, withContext } from "../../../../../lib/api";

// ─── /api/v1/purchases/:orderId ───────────────────────────────────────────────
// GET → PurchaseOrderDetail
// PATCH any of { description, subcontractorId, orderedOn, expectedOn,
//   workStart, workEnd, notes, kind (while pending), lines } → { orderId }
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ orderId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { orderId } = await params;
  return withContext(request, (ctx) => purchasingService.getPurchase(ctx, orderId));
}

export async function PATCH(request: Request, { params }: Params) {
  const { orderId } = await params;
  return withContext(request, async (ctx) => purchasingService.updatePurchase(ctx, orderId, await readJson(request)));
}
