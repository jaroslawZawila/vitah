import { constructionService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../../lib/api";

// POST /api/v1/projects/:id/obra/chapters/:code/start { date } → { state }:
// the day work really started (not after today). Pending → in progress.

type Params = { params: Promise<{ id: string; code: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, code } = await params;
  return withContext(request, async (ctx) => constructionService.startChapter(ctx, id, code, await readJson(request)));
}
