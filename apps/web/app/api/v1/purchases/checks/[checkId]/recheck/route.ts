import { purchaseChecksService } from "@repo/core";
import { withContext } from "../../../../../../../lib/api";
import { reviewed } from "../../../../../../../lib/review-documents";

// POST /api/v1/purchases/checks/:checkId/recheck → { checkId }: the AI reviews
// that purchase PDF again, after the response. A document's reviews are in its
// order's (GET /api/v1/purchases/:orderId) or invoice's (…/invoices/:invoiceId) `checks`.

type Params = { params: Promise<{ checkId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { checkId } = await params;
  return withContext(request, async (ctx) => reviewed(ctx, await purchaseChecksService.recheckDocument(ctx, checkId)));
}
