import { budgetOverviewService } from "@repo/core";
import { withContext } from "../../../../lib/api";

// GET /api/v1/budgets → BudgetOverview: every obra's newest budget revision (at
// its price, with what it waits for), the one changed last first, and the totals.

export async function GET(request: Request) {
  return withContext(request, (ctx) => budgetOverviewService.listBudgets(ctx));
}
