import { budgetOverviewService, projectsService } from "@repo/core";
import { readJson, withContext } from "../../../../lib/api";

// GET  /api/v1/projects → ProjectListItem[], each with `budget`: its newest
//                         revision's { number, status } and the AI's run (BudgetState)
// POST /api/v1/projects body { ref, address, startDate?, completionDate?,
//                              clientId? (admin only) } → { id }

export function GET(request: Request) {
  return withContext(request, (ctx) => budgetOverviewService.listProjectsWithBudget(ctx));
}

export function POST(request: Request) {
  return withContext(
    request,
    async (ctx) => projectsService.createProject(ctx, await readJson(request)),
    201,
  );
}
