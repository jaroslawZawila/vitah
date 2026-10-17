import { constructionService } from "@repo/core";
import { fileResponse, withContext } from "../../../../../../../../../../lib/api";

// ─── /api/v1/projects/:id/obra/issues/:issueId/files/:fileId ──────────────────
// GET → the file, as a download (never shown inline: it may be anything an
// email or a document can hold) · DELETE → { fileId }
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string; issueId: string; fileId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, issueId, fileId } = await params;
  return withContext(request, async (ctx) =>
    fileResponse(await constructionService.openIssueFile(ctx, id, issueId, fileId), { download: true }),
  );
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, issueId, fileId } = await params;
  return withContext(request, (ctx) => constructionService.deleteIssueFile(ctx, id, issueId, fileId));
}
