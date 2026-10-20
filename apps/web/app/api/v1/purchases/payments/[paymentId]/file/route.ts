import { purchaseInvoicesService } from "@repo/core";
import { fileResponse, withContext } from "../../../../../../../lib/api";

// GET /api/v1/purchases/payments/:paymentId/file → the payment's proof (PDF).

type Params = { params: Promise<{ paymentId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { paymentId } = await params;
  return withContext(request, async (ctx) => fileResponse(await purchaseInvoicesService.openPaymentFile(ctx, paymentId)));
}
