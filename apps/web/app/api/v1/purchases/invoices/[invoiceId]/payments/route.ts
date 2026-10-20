import { purchaseInvoicesService } from "@repo/core";
import { readWithFile, withContext } from "../../../../../../../lib/api";

// POST /api/v1/purchases/invoices/:invoiceId/payments { amountCents, paidOn?,
// method?, reference? } as JSON, or multipart with those as JSON in `data`
// and the proof (PDF) in `file` → { paymentId }

type Params = { params: Promise<{ invoiceId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { invoiceId } = await params;
  return withContext(request, async (ctx) => purchaseInvoicesService.createPayment(ctx, invoiceId, await readWithFile(request)), 201);
}
