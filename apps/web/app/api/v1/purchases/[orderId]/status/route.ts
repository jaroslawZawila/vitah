import { purchasingService } from "@repo/core";
import { readJson, withContext } from "../../../../../../lib/api";

// POST /api/v1/purchases/:orderId/status { status, date?, note? } →
// { orderId, status }: ordered, delivered, contracted, finished, cancelled…

type Params = { params: Promise<{ orderId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { orderId } = await params;
  return withContext(request, async (ctx) => purchasingService.setPurchaseStatus(ctx, orderId, await readJson(request)));
}
