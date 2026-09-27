import { budgetService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../lib/api";

// PUT { lines: [{ id, executedPct }] } → { updated }: progress on the accepted revision.

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) =>
    budgetService.setProgress(ctx, id, await readJson(request)),
  );
}
