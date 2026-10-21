import { purchaseSuppliersService } from "@repo/core";
import { withContext } from "../../../../../lib/api";

// GET /api/v1/purchases/suppliers → TenantSuppliers: every Subcontratas
// company as a supplier (ordered, invoiced, paid, owed), those owed first.

export async function GET(request: Request) {
  return withContext(request, (ctx) => purchaseSuppliersService.listSuppliers(ctx));
}
