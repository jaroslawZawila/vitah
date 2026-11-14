import { purchaseAmendmentsService } from "@repo/core";
import { readCreate, readWithFile, withContext } from "../../../../../../lib/api";
import { reviewed } from "../../../../../../lib/review-documents";

// POST /api/v1/purchases/:orderId/amendments { concept, lines: [{ lineageId,
// amountCents, closesLine? }] (all the order's lines as they will be),
// signedOn?, documentTitle? } as JSON, or multipart with those fields as JSON
// in `data` and the signed PDF in `file` → { amendmentId, number, deltaCents,
// documentFailed? }. The order's modificados are in GET /api/v1/purchases/:orderId.
// Sent again with the same `Idempotency-Key` header (or `idempotencyKey` in
// the body) it is one modificado with one PDF: the retry attaches the PDF only
// if the first call didn't.

type Params = { params: Promise<{ orderId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { orderId } = await params;
  return withContext(request, async (ctx) => reviewed(ctx, await purchaseAmendmentsService.amendPurchase(ctx, orderId, await readCreate(request, readWithFile))), 201);
}
