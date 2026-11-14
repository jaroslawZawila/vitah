import { purchasingService } from "@repo/core";
import { readCreate, withContext } from "../../../../../../lib/api";

// ─── /api/v1/projects/:id/purchases ───────────────────────────────────────────
// GET → ProjectPurchases (the project's Compras tab)
// POST { kind, subcontractorId, description, lines: [{ lineageId, amountCents,
//   closesLine? }], status?, orderedOn?, expectedOn?, workStart?, workEnd?,
//   notes?, paymentDays?, retentionBp?, vatKind?, requestId? (the approved
//   purchase request it comes from) } → { orderId, number }. Sent again with
//   the same `Idempotency-Key` header (or `idempotencyKey` in the body) it is
//   one order, answered the same.
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => purchasingService.getProjectPurchases(ctx, id));
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) => purchasingService.createPurchase(ctx, id, await readCreate(request)), 201);
}
