import { purchaseAmendmentsService } from "@repo/core";
import { readWithFile, withContext } from "../../../../../../lib/api";

// POST /api/v1/purchases/:orderId/amendments { concept, lines: [{ lineageId,
// amountCents, closesLine? }] (all the order's lines as they will be),
// signedOn?, documentTitle? } as JSON, or multipart with those fields as JSON
// in `data` and the signed PDF in `file` → { amendmentId, number, deltaCents,
// documentFailed? }. The order's modificados are in GET /api/v1/purchases/:orderId.

type Params = { params: Promise<{ orderId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { orderId } = await params;
  return withContext(request, async (ctx) => purchaseAmendmentsService.amendPurchase(ctx, orderId, await readWithFile(request)), 201);
}
