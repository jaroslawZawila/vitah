import { subcontractorsService } from "@repo/core";
import { readJson, withContext } from "../../../../../lib/api";

// ─── /api/v1/subcontractors/:id ───────────────────────────────────────────────
// GET   → SubcontractorDetail (documents with versions, workers, obras, history)
// PATCH any of SubcontractorFields → { id }
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => subcontractorsService.getSubcontractor(ctx, id));
}

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) => subcontractorsService.updateSubcontractor(ctx, id, await readJson(request)));
}
