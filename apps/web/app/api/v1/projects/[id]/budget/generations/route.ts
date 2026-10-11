import { readJson, withContext } from "../../../../../../../lib/api";
import { startBudgetGeneration } from "../../../../../../../lib/budget-generation";

// POST { documentIds, reference?, quality?, vatRateBp? } → { generationId }:
// the AI drafts the project's first budget from its budget documents.

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) => startBudgetGeneration(ctx, id, await readJson(request)), 201);
}
