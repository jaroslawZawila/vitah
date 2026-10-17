import { constructionService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../lib/api";

// PATCH /api/v1/projects/:id/obra/issues/:issueId { any field, status too } → { issueId }

type Params = { params: Promise<{ id: string; issueId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, issueId } = await params;
  return withContext(request, async (ctx) => constructionService.updateIssue(ctx, id, issueId, await readJson(request)));
}
