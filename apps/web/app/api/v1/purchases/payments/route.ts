import { purchaseInvoicesService } from "@repo/core";
import { withContext } from "../../../../../lib/api";

// GET /api/v1/purchases/payments (?projectId, ?subcontractorId) →
// TenantPayments: what is owed by week of its due date, and the payments made.

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams;
  return withContext(request, (ctx) =>
    purchaseInvoicesService.listPayments(ctx, {
      projectId: query.get("projectId") ?? undefined,
      subcontractorId: query.get("subcontractorId") ?? undefined,
    }),
  );
}
