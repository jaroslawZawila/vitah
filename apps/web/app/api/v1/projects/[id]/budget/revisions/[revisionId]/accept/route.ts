import { budgetService } from "@repo/core";
import { withContext } from "../../../../../../../../../lib/api";

// POST: the draft becomes the accepted revision (the contract).

type Params = { params: Promise<{ id: string; revisionId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, revisionId } = await params;
  return withContext(request, (ctx) => budgetService.acceptRevision(ctx, id, revisionId));
}
