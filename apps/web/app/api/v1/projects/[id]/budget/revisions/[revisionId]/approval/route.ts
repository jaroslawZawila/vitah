import { budgetApprovalsService } from "@repo/core";
import { readOptionalJson, withContext } from "../../../../../../../../../lib/api";

// POST { message?, chosenOptionIds? }: asks the project's client to approve the
// issued revision in the app → { approvalId }. DELETE: withdraws the request
// still waiting → { approvalId }. Admins and managers.

type Params = { params: Promise<{ id: string; revisionId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, revisionId } = await params;
  return withContext(
    request,
    async (ctx) => budgetApprovalsService.askApproval(ctx, id, revisionId, await readOptionalJson(request)),
    201,
  );
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, revisionId } = await params;
  return withContext(request, (ctx) => budgetApprovalsService.withdrawApproval(ctx, id, revisionId));
}
