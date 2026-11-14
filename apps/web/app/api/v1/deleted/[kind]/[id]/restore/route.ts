import { deletedService } from "@repo/core";
import { withContext } from "../../../../../../../lib/api";

// POST /api/v1/deleted/:kind/:id/restore → { kind, id, projectId }: brings a
// deleted record back, as it was. Admins only. 404 `not_found` if it isn't
// deleted (any more); 409 with what stands in the way otherwise
// (`parent_deleted`, `ref_taken`, `duplicate_number`, or its module's own
// code: `exceeds_amount`, `invalid_state`…).

type Params = { params: Promise<{ kind: string; id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { kind, id } = await params;
  return withContext(request, (ctx) => deletedService.restoreDeleted(ctx, kind, id));
}
