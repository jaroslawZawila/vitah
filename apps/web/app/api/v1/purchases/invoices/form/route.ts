import { purchaseInvoicesService } from "@repo/core";
import { withContext } from "../../../../../../lib/api";

// GET /api/v1/purchases/invoices/form (?orderId, ?invoiceId) →
// PurchaseInvoiceForm: the orders that can be invoiced and, for one, its
// terms, milestones, lines and invoices; with `invoiceId`, that invoice to edit.

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  return withContext(request, (ctx) =>
    purchaseInvoicesService.getInvoiceForm(ctx, {
      orderId: query.get("orderId") ?? undefined,
      invoiceId: query.get("invoiceId") ?? undefined,
    }),
  );
}
