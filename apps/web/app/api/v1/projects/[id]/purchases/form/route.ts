import { purchasingService } from "@repo/core";
import { withContext } from "../../../../../../../lib/api";

// GET /api/v1/projects/:id/purchases/form (?orderId= when editing) →
// PurchaseForm: the suppliers and the contract's lines to order from.

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const orderId = new URL(request.url).searchParams.get("orderId") ?? undefined;
  return withContext(request, (ctx) => purchasingService.getPurchaseForm(ctx, id, orderId));
}
