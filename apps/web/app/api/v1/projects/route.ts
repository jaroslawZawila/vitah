import { budgetOverviewService, projectsService } from "@repo/core";
import { readJson, withContext } from "../../../../lib/api";

// GET  /api/v1/projects → ProjectListItem[], each with `budget`: its newest
//                         revision's { number, status } and the AI's run (BudgetState);
//                         with `?signals=1` also `schedule`, `progressPct` and `attention`
//                         (ProjectSignals, as the portal's list), absent without it
// POST /api/v1/projects body { ref, address, startDate?, completionDate?,
//                              clientId? (admin only) } → { id }

export function GET(request: Request) {
  const signals = new URL(request.url).searchParams.get("signals") === "1";
  return withContext(request, (ctx) => budgetOverviewService.listProjectsWithBudget(ctx, { signals }));
}

export function POST(request: Request) {
  return withContext(
    request,
    async (ctx) => projectsService.createProject(ctx, await readJson(request)),
    201,
  );
}
