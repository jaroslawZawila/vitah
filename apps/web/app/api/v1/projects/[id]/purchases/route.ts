import { purchasingService } from "@repo/core";
import { readJson, withContext } from "../../../../../../lib/api";

// ─── /api/v1/projects/:id/purchases ───────────────────────────────────────────
// GET → ProjectPurchases (the project's Compras tab)
// POST { kind, subcontractorId, description, lines: [{ lineageId, amountCents,
//   closesLine? }], status?, orderedOn?, expectedOn?, workStart?, workEnd?,
//   notes? } → { orderId, number }
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => purchasingService.getProjectPurchases(ctx, id));
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) => purchasingService.createPurchase(ctx, id, await readJson(request)), 201);
}
