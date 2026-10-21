import { purchaseInvoicesService } from "@repo/core";
import { readWithFile, withContext } from "../../../../../../lib/api";
import { reviewed } from "../../../../../../lib/review-documents";

// POST /api/v1/purchases/:orderId/invoices { kind?, number, issuedOn, dueOn?,
// milestoneId?, rectifiesId?, baseCents, vatKind?, irpfBp?, retentionBp?,
// lines?, notes? } as JSON, or multipart with those as JSON in `data` and the
// PDF in `file` → { invoiceId }: a supplier's invoice (or credit note) on the order.

type Params = { params: Promise<{ orderId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { orderId } = await params;
  return withContext(request, async (ctx) => reviewed(ctx, await purchaseInvoicesService.createInvoice(ctx, orderId, await readWithFile(request))), 201);
}
