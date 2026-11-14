import { purchaseInvoicesService } from "@repo/core";
import { queryOf, withContext } from "../../../../../lib/api";

// ─── /api/v1/purchases/invoices ───────────────────────────────────────────────
// GET (?projectId, ?subcontractorId) → TenantInvoices: the suppliers'
//   invoices, owed first, with what is owed, past due and due soon. One is
//   registered on its order: POST /api/v1/purchases/:orderId/invoices
//   ?page (from 1), ?limit (50 by default, 200 at most): one page of them,
//     located by `paging`. Without either, as before paging existed: all of
//     them, up to 5,000; cut there, `paging.truncated` is true and
//     `paging.total` says how many there are
//   ?group (open | overdue | paid | credit) and ?q (text) narrow the list,
//     never the summary
//   400 `invalid_page` for a page or limit that isn't a whole number from 1
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const { projectId, subcontractorId, page, limit, group, q } = queryOf(request);
  return withContext(request, (ctx) => purchaseInvoicesService.listInvoices(ctx, { projectId, subcontractorId }, { page, limit, group, q }));
}
