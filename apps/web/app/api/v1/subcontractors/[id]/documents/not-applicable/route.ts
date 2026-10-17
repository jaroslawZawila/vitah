import { subcontractorsService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../lib/api";

// POST /api/v1/subcontractors/:id/documents/not-applicable { requirementId, reason } — optional documents only.

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) => subcontractorsService.markNotApplicable(ctx, id, await readJson(request)));
}
