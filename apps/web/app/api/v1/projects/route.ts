import { projectsService } from "@repo/core";
import { readJson, withContext } from "../../../../lib/api";

// GET  /api/v1/projects → ProjectListItem[]
// POST /api/v1/projects body { ref, address, startDate?, completionDate?,
//                              clientId? (admin only) } → { id }

export function GET(request: Request) {
  return withContext(request, (ctx) => projectsService.listProjects(ctx));
}

export function POST(request: Request) {
  return withContext(
    request,
    async (ctx) => projectsService.createProject(ctx, await readJson(request)),
    201,
  );
}
