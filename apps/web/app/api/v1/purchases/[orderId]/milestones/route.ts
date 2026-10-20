import { purchaseInvoicesService } from "@repo/core";
import { readJson, withContext } from "../../../../../../lib/api";

// PUT /api/v1/purchases/:orderId/milestones { milestones: [{ id?, concept,
// amountCents }] } → { orderId }: the order's payment schedule, adding up to
// its amount ([] drops it); an invoiced milestone keeps its amount.

type Params = { params: Promise<{ orderId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { orderId } = await params;
  return withContext(request, async (ctx) => purchaseInvoicesService.setOrderMilestones(ctx, orderId, await readJson(request)));
}
