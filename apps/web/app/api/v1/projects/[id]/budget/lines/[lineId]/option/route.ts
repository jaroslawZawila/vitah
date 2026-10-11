import { budgetOptionsService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../../lib/api";

// POST { kind: "deduction" | "alternative" } → { optionId }: offers a draft's
// line as an option (the owner does it, or another solution replaces it).

type Params = { params: Promise<{ id: string; lineId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, lineId } = await params;
  return withContext(
    request,
    async (ctx) => budgetOptionsService.optionFromLine(ctx, id, lineId, await readJson(request)),
    201,
  );
}
