import { purchaseSuppliersService } from "@repo/core";
import { withContext } from "../../../../../../lib/api";

// GET /api/v1/purchases/suppliers/:subcontractorId → SupplierPurchasing: its
// figures, orders across the obras, invoices (owed first) and payments.

type Params = { params: Promise<{ subcontractorId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { subcontractorId } = await params;
  return withContext(request, (ctx) => purchaseSuppliersService.getSupplierPurchasing(ctx, subcontractorId));
}
