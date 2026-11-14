import { mfaService } from "@repo/core";
import { withContext } from "../../../../../lib/api";

// Any staff user, about themselves: two-step verification (a code from an
// authenticator app after the password, when signing in to the portal).
// GET /api/v1/me/mfa → { enabled, recoveryCodesLeft }
//
// Switching it on is two calls: POST …/mfa/begin, then POST …/mfa/confirm.
// See also …/mfa/disable and …/mfa/recovery-codes. The secret is answered by
// `begin` only; nothing ever answers it, or the stored hashes, afterwards.
// All of them (and DELETE /api/v1/users/:id/mfa) answer 503 `mfa_unavailable`
// while the database has no `user_mfa` table yet (the portal deployed ahead of
// its SQL): nobody can have it on, and signing in goes on without it.

export function GET(request: Request) {
  return withContext(request, (ctx) => mfaService.getStatus(ctx));
}
