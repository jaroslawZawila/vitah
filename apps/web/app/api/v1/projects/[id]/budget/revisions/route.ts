import { budgetService } from "@repo/core";
import { withContext } from "../../../../../../../lib/api";

// POST /api/v1/projects/:id/budget/revisions → { revisionId }: a new draft,
// copied from the newest revision.

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => budgetService.createRevision(ctx, id), 201);
}
