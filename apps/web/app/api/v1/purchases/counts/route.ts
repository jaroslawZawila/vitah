import { purchaseInvoicesService } from "@repo/core";
import { withContext } from "../../../../../lib/api";

// GET /api/v1/purchases/counts → PurchasingCounts: orders, invoices and
// payments, and the invoices past due or due within a week.

export async function GET(request: Request) {
  return withContext(request, (ctx) => purchaseInvoicesService.getPurchasingCounts(ctx));
}
