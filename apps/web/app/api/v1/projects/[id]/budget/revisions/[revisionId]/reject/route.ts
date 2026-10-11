import { budgetService } from "@repo/core";
import { readOptionalJson, withContext } from "../../../../../../../../../lib/api";

// POST { rejectedOn? }: the client turned the issued revision down.

type Params = { params: Promise<{ id: string; revisionId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, revisionId } = await params;
  return withContext(request, async (ctx) =>
    budgetService.rejectRevision(ctx, id, revisionId, await readOptionalJson(request)),
  );
}
