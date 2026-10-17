import { constructionService } from "@repo/core";
import { withContext } from "../../../../../../../lib/api";

// POST /api/v1/projects/:id/obra/review → { revisionId }: the chapters the
// accepted revision added or removed are reviewed.

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => constructionService.reviewChanges(ctx, id));
}
