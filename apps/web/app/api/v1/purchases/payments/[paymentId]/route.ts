import { purchaseInvoicesService } from "@repo/core";
import { withContext } from "../../../../../../lib/api";

// DELETE /api/v1/purchases/payments/:paymentId → { paymentId }: a payment
// recorded by mistake (a soft delete: the invoice owes it again, its proof stays).

type Params = { params: Promise<{ paymentId: string }> };

export async function DELETE(request: Request, { params }: Params) {
  const { paymentId } = await params;
  return withContext(request, (ctx) => purchaseInvoicesService.deletePayment(ctx, paymentId));
}
