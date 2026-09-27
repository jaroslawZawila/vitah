import { budgetService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../lib/api";

// PATCH any of { code, description, unit, quantity, unitPriceCents } · DELETE (drafts)

type Params = { params: Promise<{ id: string; lineId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, lineId } = await params;
  return withContext(request, async (ctx) =>
    budgetService.updateLine(ctx, id, lineId, await readJson(request)),
  );
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, lineId } = await params;
  return withContext(request, (ctx) => budgetService.deleteLine(ctx, id, lineId));
}
