import { budgetApprovalsService } from "@repo/core";
import { withContext } from "../../../../../../../../../../lib/api";

// PUT: links the change (CAM-) `issueId` to the revision that prices it;
// DELETE: unlinks it. → { revisionId, issueId }. Admins and managers; refused
// (`links_frozen`) once the client was asked or the revision decided.

type Params = { params: Promise<{ id: string; revisionId: string; issueId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id, revisionId, issueId } = await params;
  return withContext(request, (ctx) => budgetApprovalsService.linkChange(ctx, id, revisionId, issueId));
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, revisionId, issueId } = await params;
  return withContext(request, (ctx) => budgetApprovalsService.unlinkChange(ctx, id, revisionId, issueId));
}
