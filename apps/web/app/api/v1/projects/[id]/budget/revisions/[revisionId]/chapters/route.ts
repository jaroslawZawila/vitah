import { budgetService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../../lib/api";

// POST { code, name, changeNote? } → { chapterId } (drafts)

type Params = { params: Promise<{ id: string; revisionId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, revisionId } = await params;
  return withContext(
    request,
    async (ctx) => budgetService.addChapter(ctx, id, revisionId, await readJson(request)),
    201,
  );
}
