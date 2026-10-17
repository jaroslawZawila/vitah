import { subcontractorsService } from "@repo/core";
import { withContext } from "../../../../../lib/api";

// GET /api/v1/subcontractors/overview → SubcontractorsOverview (KPIs, attention list, companies)

export async function GET(request: Request) {
  return withContext(request, (ctx) => subcontractorsService.getOverview(ctx));
}
