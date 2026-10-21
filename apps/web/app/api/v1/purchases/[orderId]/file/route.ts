import { purchaseDocumentsService } from "@repo/core";
import { fileResponse, readForm, withContext } from "../../../../../../lib/api";
import { reviewed } from "../../../../../../lib/review-documents";

// ─── /api/v1/purchases/:orderId/file ──────────────────────────────────────────
// The single PDF an order had, kept for older clients: its first document
// (…/documents for all of them). GET → its current version · POST multipart
// { file } (PDF ≤ 4 MB, a new version; the first document if none) → { orderId }
// · DELETE → { orderId }: the first document
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ orderId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { orderId } = await params;
  return withContext(request, async (ctx) => fileResponse(await purchaseDocumentsService.openPurchaseFile(ctx, orderId)));
}

export async function POST(request: Request, { params }: Params) {
  const { orderId } = await params;
  return withContext(request, async (ctx) => reviewed(ctx, await purchaseDocumentsService.uploadPurchaseFile(ctx, orderId, await readForm(request))), 201);
}

export async function DELETE(request: Request, { params }: Params) {
  const { orderId } = await params;
  return withContext(request, (ctx) => purchaseDocumentsService.deletePurchaseFile(ctx, orderId));
}
