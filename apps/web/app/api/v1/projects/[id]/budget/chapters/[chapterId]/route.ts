import { budgetService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../lib/api";

// PATCH { code?, name?, changeNote? } · DELETE (drafts)

type Params = { params: Promise<{ id: string; chapterId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, chapterId } = await params;
  return withContext(request, async (ctx) =>
    budgetService.updateChapter(ctx, id, chapterId, await readJson(request)),
  );
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, chapterId } = await params;
  return withContext(request, (ctx) => budgetService.deleteChapter(ctx, id, chapterId));
}
