import { budgetService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../../lib/api";

// POST { code, description, unit, quantity, unitPriceCents } → { lineId } (drafts)

type Params = { params: Promise<{ id: string; chapterId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, chapterId } = await params;
  return withContext(
    request,
    async (ctx) => budgetService.addLine(ctx, id, chapterId, await readJson(request)),
    201,
  );
}
