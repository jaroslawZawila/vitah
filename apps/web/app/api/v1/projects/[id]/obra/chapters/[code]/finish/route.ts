import { constructionService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../../lib/api";

// POST /api/v1/projects/:id/obra/chapters/:code/finish { date } →
// { state, invoiceRequested }: the day work really finished. In progress →
// finished; when it completes a hito, its invoice is requested (the hito's code).

type Params = { params: Promise<{ id: string; code: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, code } = await params;
  return withContext(request, async (ctx) => constructionService.finishChapter(ctx, id, code, await readJson(request)));
}
