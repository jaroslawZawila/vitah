import { budgetService } from "@repo/core";
import { readOptionalJson, withContext } from "../../../../../../../../../lib/api";

// POST { acceptedOn?, acceptedBy?, chosenOptionIds? } (all optional): the
// issued revision becomes the contract, registered by the caller. `acceptedOn`
// is between the day it was issued and today (`invalid_date`); a draft, never
// sent to the client, is refused (`not_issued`).

type Params = { params: Promise<{ id: string; revisionId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, revisionId } = await params;
  return withContext(request, async (ctx) =>
    budgetService.acceptRevision(ctx, id, revisionId, await readOptionalJson(request)),
  );
}
