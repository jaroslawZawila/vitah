import { clientsService } from "@repo/core";
import { readJson, withContext } from "../../../../../../lib/api";

// Admin only (403 otherwise).
// PUT /api/v1/clients/:id/password  body { password } → { id }

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) =>
    clientsService.setClientPassword(ctx, id, await readJson(request)),
  );
}
