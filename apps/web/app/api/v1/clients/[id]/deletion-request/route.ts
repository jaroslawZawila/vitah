import { clientsService } from "@repo/core";
import { withContext } from "../../../../../../lib/api";

// Admin only (403 otherwise).
// DELETE /api/v1/clients/:id/deletion-request → { id }: the client's request
// for their account to be deleted is handled (`deletionRequestedAt` back to
// null in GET /api/v1/clients). Deletes nothing.

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => clientsService.clearDeletionRequest(ctx, id));
}
