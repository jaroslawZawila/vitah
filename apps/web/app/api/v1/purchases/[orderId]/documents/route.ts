import { purchaseDocumentsService } from "@repo/core";
import { readForm, withContext } from "../../../../../../lib/api";
import { reviewed } from "../../../../../../lib/review-documents";

// POST /api/v1/purchases/:orderId/documents multipart { title, file (PDF ≤ 4 MB),
// note? } → { documentId, version }: a new document of the order (the order,
// the signed contract, an annex…). The documents come with the order (GET
// /api/v1/purchases/:orderId → `documents`).

type Params = { params: Promise<{ orderId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { orderId } = await params;
  return withContext(request, async (ctx) => reviewed(ctx, await purchaseDocumentsService.addOrderDocument(ctx, orderId, await readForm(request))), 201);
}
