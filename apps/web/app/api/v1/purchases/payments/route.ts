import { purchaseInvoicesService } from "@repo/core";
import { queryOf, withContext } from "../../../../../lib/api";

// GET /api/v1/purchases/payments (?projectId, ?subcontractorId) →
// TenantPayments: what is owed by week of its due date, and the payments made.
// ?page (from 1), ?limit (50 by default, 200 at most): one page of the
// payments, located by `paging`; without either, all of them (up to 5,000;
// cut there, `paging.truncated` is true and `paging.total` says how many there are).
// 400 `invalid_page` for a page or limit that isn't a whole number from 1.

export async function GET(request: Request) {
  const { projectId, subcontractorId, page, limit } = queryOf(request);
  return withContext(request, (ctx) => purchaseInvoicesService.listPayments(ctx, { projectId, subcontractorId }, { page, limit }));
}
