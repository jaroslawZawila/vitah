import { usersService } from "@repo/core";
import { readJson, withContext } from "../../../../../../lib/api";

// Admin only (403 otherwise), for another staff user of the tenant (404 otherwise).
// PUT /api/v1/users/:id/password  body { password } → { id }
//   Signs that user out everywhere. 400 { error } for weak_password (10+
//   characters, an uppercase letter and a number) and cannot_reset_own_password
//   (an admin changes their own with POST /api/v1/me/password).

type Params = { params: Promise<{ id: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) =>
    usersService.resetUserPassword(ctx, id, await readJson(request)),
  );
}
