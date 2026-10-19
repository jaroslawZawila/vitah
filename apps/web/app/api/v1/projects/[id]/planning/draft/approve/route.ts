import { planningService } from "@repo/core";
import { readOptionalJson, withContext } from "../../../../../../../../lib/api";

// POST /api/v1/projects/:id/planning/draft/approve { reason?, items?, startDate?,
// region?, augustClosure?, christmasClosure? } → 204: the draft (with any rules and
// calendar sent, as PUT …/draft takes them) becomes the baseline, in one go. A
// change to an approved plan needs its reason.

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) => planningService.approvePlanningDraft(ctx, id, await readOptionalJson(request)), 204);
}
