import { BUDGET_PDF_KINDS, budgetIssueService, CoreError, type BudgetPdfKind } from "@repo/core";
import { fileResponse, withContext } from "../../../../../../../../../lib/api";

// GET ?kind=general|detailed → the revision's PDF: the stored one once issued,
// else rendered now with a "BORRADOR" watermark.

type Params = { params: Promise<{ id: string; revisionId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, revisionId } = await params;
  const kind = new URL(request.url).searchParams.get("kind") ?? "general";
  return withContext(request, async (ctx) => {
    if (!BUDGET_PDF_KINDS.includes(kind as BudgetPdfKind)) throw new CoreError("invalid_input", 400);
    return fileResponse(await budgetIssueService.revisionPdf(ctx, id, revisionId, kind as BudgetPdfKind));
  });
}
