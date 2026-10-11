import { documentsService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../lib/api";

// POST { pathname, budgetInput, filename, title? } → { documentId }: records a
// budget input uploaded straight to the store (see ./uploads).

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(
    request,
    async (ctx) => documentsService.registerBudgetInput(ctx, id, await readJson(request)),
    201,
  );
}
