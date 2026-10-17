import { purchasingService } from "@repo/core";
import { withContext } from "../../../../../../lib/api";

// GET /api/v1/subcontractors/:id/purchases → PurchaseOrderListItem[]: the
// company's (or material supplier's) orders across the tenant's projects.

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => purchasingService.listSupplierOrders(ctx, id));
}
