import { purchasingService } from "@repo/core";
import { fileResponse, readForm, withContext } from "../../../../../../lib/api";

// ─── /api/v1/purchases/:orderId/file ──────────────────────────────────────────
// GET → the order's PDF · POST multipart { file } (PDF ≤ 4 MB, replaces the
// one it had) → { orderId } · DELETE → { orderId }
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ orderId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { orderId } = await params;
  return withContext(request, async (ctx) => fileResponse(await purchasingService.openPurchaseFile(ctx, orderId)));
}

export async function POST(request: Request, { params }: Params) {
  const { orderId } = await params;
  return withContext(request, async (ctx) => purchasingService.uploadPurchaseFile(ctx, orderId, await readForm(request)), 201);
}

export async function DELETE(request: Request, { params }: Params) {
  const { orderId } = await params;
  return withContext(request, (ctx) => purchasingService.deletePurchaseFile(ctx, orderId));
}
