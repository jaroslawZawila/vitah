import { purchaseInvoicesService } from "@repo/core";
import { readCreate, readWithFile, withContext } from "../../../../../../../lib/api";
import { reviewed } from "../../../../../../../lib/review-documents";

// POST /api/v1/purchases/invoices/:invoiceId/payments { amountCents, paidOn?,
// method?, reference? } as JSON, or multipart with those as JSON in `data`
// and the proof (PDF) in `file` → { paymentId }. Sent again with the same
// `Idempotency-Key` header (or `idempotencyKey` in the body) it is paid once,
// and answered the same; the key with another payment is 409
// `idempotency_key_reused`.

type Params = { params: Promise<{ invoiceId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return withContext(request, async (ctx) => reviewed(ctx, await purchaseInvoicesService.createPayment(ctx, invoiceId, await readCreate(request, readWithFile))), 201);
}
