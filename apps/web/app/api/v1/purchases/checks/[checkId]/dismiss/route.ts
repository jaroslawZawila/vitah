import { purchaseChecksService } from "@repo/core";
import { withContext } from "../../../../../../../lib/api";

// POST /api/v1/purchases/checks/:checkId/dismiss → { checkId }: its warnings are marked as seen.

type Params = { params: Promise<{ checkId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { checkId } = await params;
  return withContext(request, (ctx) => purchaseChecksService.dismissCheck(ctx, checkId));
}
