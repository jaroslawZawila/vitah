import { budgetOptionsService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../lib/api";

// PATCH  { name?, optionKind?, intro?, replacesLine? } (drafts)
// DELETE (drafts)

type Params = { params: Promise<{ id: string; optionId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, optionId } = await params;
  return withContext(request, async (ctx) =>
    budgetOptionsService.updateOption(ctx, id, optionId, await readJson(request)),
  );
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, optionId } = await params;
  return withContext(request, (ctx) => budgetOptionsService.deleteOption(ctx, id, optionId));
}
