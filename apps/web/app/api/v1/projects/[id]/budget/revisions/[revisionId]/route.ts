import { budgetService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../lib/api";

// PATCH  { reference?, vatRateBp?, builtAreaM2?, usefulAreaM2?, exclusions? } (drafts)
// DELETE (drafts)

type Params = { params: Promise<{ id: string; revisionId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, revisionId } = await params;
  return withContext(request, async (ctx) =>
    budgetService.updateRevision(ctx, id, revisionId, await readJson(request)),
  );
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, revisionId } = await params;
  return withContext(request, (ctx) => budgetService.deleteRevision(ctx, id, revisionId));
}
