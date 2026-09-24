import { usersService } from "@repo/core";
import { readJson, withContext } from "../../../../../lib/api";

// Admin only (403 otherwise).
// PATCH /api/v1/users/:id  body { role?, active? } → { id }

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) =>
    usersService.updateUser(ctx, id, await readJson(request)),
  );
}
