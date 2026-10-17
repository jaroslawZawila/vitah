import { subcontractorsService } from "@repo/core";
import { withContext } from "../../../../../lib/api";

// GET /api/v1/subcontractors/projects → ProjectOption[] (obras to assign companies to, with their chapters)

export async function GET(request: Request) {
  return withContext(request, (ctx) => subcontractorsService.listProjectOptions(ctx));
}
