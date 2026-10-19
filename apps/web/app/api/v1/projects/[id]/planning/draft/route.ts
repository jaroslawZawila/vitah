import { planningService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../lib/api";

// ─── /api/v1/projects/:id/planning/draft ──────────────────────────────────────
// GET → PlanningDraft (the open draft, recomputed as of today)
// POST { from: "template" | "project" | "baseline", startDate?, region?,
//   augustClosure?, christmasClosure?, projectId? } → { versionId, number }
// PUT { items: [{ code, after, lagDays, durationDays, fixedStart }],
//   startDate?, region?, augustClosure?, christmasClosure? } → 204
// DELETE → 204: throws the draft away
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => planningService.getPlanningDraft(ctx, id));
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) => planningService.createPlanningDraft(ctx, id, await readJson(request)), 201);
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) => planningService.updatePlanningDraft(ctx, id, await readJson(request)), 204);
}

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => planningService.discardPlanningDraft(ctx, id), 204);
}
