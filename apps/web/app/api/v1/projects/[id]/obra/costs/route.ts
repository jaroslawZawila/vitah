import { constructionService } from "@repo/core";
import { withContext } from "../../../../../../../lib/api";

// GET /api/v1/projects/:id/obra/costs → ConstructionCosts (budgeted cost against
// contracted amount, per budget line).

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => constructionService.getCosts(ctx, id));
}
