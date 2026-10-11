import { budgetOptionsService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../../lib/api";

// POST { name, optionKind?, intro?, replacesLine? } → { optionId } (drafts).
// Its lines go through POST /budget/chapters/:optionId/lines, without a code.

type Params = { params: Promise<{ id: string; revisionId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, revisionId } = await params;
  return withContext(
    request,
    async (ctx) => budgetOptionsService.addOption(ctx, id, revisionId, await readJson(request)),
    201,
  );
}
