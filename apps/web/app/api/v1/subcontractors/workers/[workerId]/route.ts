import { subcontractorWorkersService } from "@repo/core";
import { readJson, withContext } from "../../../../../../lib/api";

// ─── /api/v1/subcontractors/workers/:workerId ─────────────────────────────────
// GET   → WorkerDetail (documents, access anywhere and on each obra)
// PATCH any of WorkerFields → { id }
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ workerId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { workerId } = await params;
  return withContext(request, (ctx) => subcontractorWorkersService.getWorker(ctx, workerId));
}

export async function PATCH(request: Request, { params }: Params) {
  const { workerId } = await params;
  return withContext(request, async (ctx) =>
    subcontractorWorkersService.updateWorker(ctx, workerId, await readJson(request)),
  );
}
