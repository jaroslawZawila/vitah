import { subcontractorWorkersService } from "@repo/core";
import { asksForPage, queryOf, readJson, withContext } from "../../../../../lib/api";

// ─── /api/v1/subcontractors/workers ───────────────────────────────────────────
// GET  ?projectId= → WorkerListItem[] (access on that obra when given): every
//        worker, as before paging existed
//      with ?page (from 1) or ?limit (50 by default, 200 at most) → WorkersPage:
//        { workers, paging, counts, summary }, one page of those ?access
//        (ok | pending | blocked), ?companyId and ?q (text) keep; 400
//        `invalid_page` for a page or limit that isn't a whole number from 1
// POST WorkerFields → { id }
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const query = queryOf(request);
  return withContext(request, (ctx) =>
    asksForPage(query)
      ? subcontractorWorkersService.listWorkersPage(ctx, query)
      : subcontractorWorkersService.listWorkers(ctx, { projectId: query.projectId ?? null }),
  );
}

export async function POST(request: Request) {
  return withContext(
    request,
    async (ctx) => subcontractorWorkersService.createWorker(ctx, await readJson(request)),
    201,
  );
}
