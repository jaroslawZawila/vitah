import { planningService } from "@repo/core";
import { withContext } from "../../../../../../../lib/api";

// GET /api/v1/projects/:id/planning/versions → PlanningVersions (every version
// of the plan, newest first, with each chapter's dates).

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => planningService.getPlanningVersions(ctx, id));
}
