import { subcontractorWorkersService } from "@repo/core";
import { withContext } from "../../../../../../lib/api";

// GET /api/v1/subcontractors/workers/check?query=<DNI/NIE or TPC>&projectId= → AccessCheckResult

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  return withContext(request, (ctx) =>
    subcontractorWorkersService.checkAccess(ctx, { query: params.get("query"), projectId: params.get("projectId") }),
  );
}
