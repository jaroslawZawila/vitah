import { subcontractorWorkersService } from "@repo/core";
import { readJson, withContext } from "../../../../../lib/api";

// ─── /api/v1/subcontractors/workers ───────────────────────────────────────────
// GET  ?projectId= → WorkerListItem[] (access on that obra when given)
// POST WorkerFields → { id }
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId");
  return withContext(request, (ctx) => subcontractorWorkersService.listWorkers(ctx, { projectId }));
}

export async function POST(request: Request) {
  return withContext(
    request,
    async (ctx) => subcontractorWorkersService.createWorker(ctx, await readJson(request)),
    201,
  );
}
