import { purchaseRequestsService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../lib/api";

// POST /api/v1/projects/:id/purchases/requests { kind, description, lines:
// [{ lineageId, amountCents }], neededBy?, subcontractorId?, notes? } →
// { requestId, number }. What it picks from is the order form's
// (GET /api/v1/projects/:id/purchases/form); a project's requests are listed
// by GET /api/v1/purchases/requests?projectId=.

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) => purchaseRequestsService.createRequest(ctx, id, await readJson(request)), 201);
}
