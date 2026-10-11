import { budgetIssueService } from "@repo/core";
import { readOptionalJson, withContext } from "../../../../../../../../../lib/api";

// POST { issuedOn?, validUntil?, changeReason?, shareWithClient? }: freezes the
// draft and stores its general and detailed PDFs as project documents.

type Params = { params: Promise<{ id: string; revisionId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, revisionId } = await params;
  return withContext(request, async (ctx) =>
    budgetIssueService.issueRevision(ctx, id, revisionId, await readOptionalJson(request)),
  );
}
