import { constructionService } from "@repo/core";
import { readForm, withContext } from "../../../../../../../../../lib/api";

// POST /api/v1/projects/:id/obra/issues/:issueId/files multipart { file } →
// { fileId }: a photo, email or document (≤ 4 MB) supporting the record.

type Params = { params: Promise<{ id: string; issueId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, issueId } = await params;
  return withContext(request, async (ctx) => constructionService.addIssueFile(ctx, id, issueId, await readForm(request)), 201);
}
