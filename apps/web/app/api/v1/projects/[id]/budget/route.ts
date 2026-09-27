import { budgetService } from "@repo/core";
import { readJson, withContext } from "../../../../../../lib/api";

// ─── /api/v1/projects/:id/budget ──────────────────────────────────────────────
// GET ?revision=<id> → ProjectBudget (all revisions; one in full, default newest)
// POST { reference?, number? } → { revisionId } (the first, draft revision)
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  const revision = new URL(request.url).searchParams.get("revision") ?? undefined;
  return withContext(request, (ctx) => budgetService.getBudget(ctx, id, revision));
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(
    request,
    async (ctx) => budgetService.createBudget(ctx, id, await readJson(request)),
    201,
  );
}
