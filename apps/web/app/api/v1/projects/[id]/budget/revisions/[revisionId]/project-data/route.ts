import { budgetService } from "@repo/core";
import { withContext } from "../../../../../../../../../lib/api";

// POST: a draft's cover takes the project's client and address where it
// doesn't already name them ("Usar los datos del proyecto"). Answers
// { revisionId, changed: ("promoter" | "site")[] }; 409 `not_draft` once issued.

type Params = { params: Promise<{ id: string; revisionId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, revisionId } = await params;
  return withContext(request, (ctx) => budgetService.takeProjectData(ctx, id, revisionId));
}
