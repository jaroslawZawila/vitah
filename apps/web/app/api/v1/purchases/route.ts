import { purchasingService } from "@repo/core";
import { withContext } from "../../../../lib/api";

// GET /api/v1/purchases → TenantPurchases: every order of the tenant, with the
// totals Administration watches.

export async function GET(request: Request) {
  return withContext(request, (ctx) => purchasingService.listPurchases(ctx));
}
