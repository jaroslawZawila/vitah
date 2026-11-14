import { purchasingService } from "@repo/core";
import { queryOf, withContext } from "../../../../lib/api";

// GET /api/v1/purchases → TenantPurchases: the tenant's orders, newest first,
// with the totals Administration watches (always the whole tenant's).
//   ?page (from 1), ?limit (50 by default, 200 at most): one page of them,
//     located by `paging`. Without either, as before paging existed: all of
//     them, up to 5,000; when that cut the list, `paging.truncated` is true
//     and `paging.total` says how many there are (ask by page for the rest)
//   ?group (open | pending | done | cancelled), ?projectId, ?supplierId,
//     ?kind (material | subcontract), ?from, ?to (order date), ?late=1, ?q
//     (text) narrow the list
//   ?by=supplier adds `bySupplier`: the kept orders by supplier
// 400 `invalid_page` for a page or limit that isn't a whole number from 1.

export async function GET(request: Request) {
  return withContext(request, (ctx) => purchasingService.listPurchases(ctx, queryOf(request)));
}
