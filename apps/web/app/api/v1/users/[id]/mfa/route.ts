import { mfaService } from "@repo/core";
import { withContext } from "../../../../../../lib/api";

// Admin only (403 otherwise), for another staff user of the tenant (404 otherwise).
// DELETE /api/v1/users/:id/mfa → { id }
//   Removes that user's two-step verification (a lost phone): they sign in
//   with the password alone, and are signed out everywhere. 400 { error } for
//   mfa_not_enabled and cannot_remove_own_mfa (an admin turns their own off
//   with POST /api/v1/me/mfa/disable).

type Params = { params: Promise<{ id: string }> };

export async function DELETE(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => mfaService.removeUserMfa(ctx, id));
}
