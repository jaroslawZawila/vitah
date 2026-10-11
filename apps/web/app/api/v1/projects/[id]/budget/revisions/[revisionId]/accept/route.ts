import { budgetService } from "@repo/core";
import { readOptionalJson, withContext } from "../../../../../../../../../lib/api";

// POST { acceptedOn?, acceptedBy?, chosenOptionIds? } (all optional): the
// issued revision (or a draft, as before issuing existed) becomes the contract.

type Params = { params: Promise<{ id: string; revisionId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, revisionId } = await params;
  return withContext(request, async (ctx) =>
    budgetService.acceptRevision(ctx, id, revisionId, await readOptionalJson(request)),
  );
}
