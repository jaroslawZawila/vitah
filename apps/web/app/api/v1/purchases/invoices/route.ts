import { purchaseInvoicesService } from "@repo/core";
import { withContext } from "../../../../../lib/api";

// ─── /api/v1/purchases/invoices ───────────────────────────────────────────────
// GET (?projectId, ?subcontractorId) → TenantInvoices: the suppliers'
//   invoices, owed first, with what is owed, past due and due soon. One is
//   registered on its order: POST /api/v1/purchases/:orderId/invoices
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  return withContext(request, (ctx) =>
    purchaseInvoicesService.listInvoices(ctx, {
      projectId: query.get("projectId") ?? undefined,
      subcontractorId: query.get("subcontractorId") ?? undefined,
    }),
  );
}
