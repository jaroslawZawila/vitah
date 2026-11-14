import { purchaseRequestsService } from "@repo/core";
import { readCreate, withContext } from "../../../../../../../lib/api";

// POST /api/v1/projects/:id/purchases/requests { kind, description, lines:
// [{ lineageId, amountCents }], neededBy?, subcontractorId?, notes? } →
// { requestId, number }. What it picks from is the order form's
// (GET /api/v1/projects/:id/purchases/form); a project's requests are listed
// by GET /api/v1/purchases/requests?projectId=. Sent again with the same
// `Idempotency-Key` header (or `idempotencyKey` in the body) it is one
// request, answered the same.

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) => purchaseRequestsService.createRequest(ctx, id, await readCreate(request)), 201);
}
