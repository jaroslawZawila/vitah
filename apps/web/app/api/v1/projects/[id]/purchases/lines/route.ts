import { purchasingService } from "@repo/core";
import { withContext } from "../../../../../../../lib/api";

// GET /api/v1/projects/:id/purchases/lines → ProjectPurchaseLines: the obra's
// Compras by budget line (to contract → contracted → invoiced → paid), with
// each line's orders, their milestones and invoices, and the invoices due.

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => purchasingService.getProjectPurchaseLines(ctx, id));
}
