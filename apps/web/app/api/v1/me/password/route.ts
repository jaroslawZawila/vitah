import { usersService } from "@repo/core";
import { readJson, withContext } from "../../../../../lib/api";

// Any staff user, about themselves.
// POST /api/v1/me/password  body { currentPassword, newPassword } → { success: true }
//   The new password needs 10+ characters, an uppercase letter and a number.
//   400 { error } for missing_fields, wrong_password, weak_password and
//   same_password; 429 too_many_attempts after 10 wrong current passwords.
//   The change signs the user out everywhere, the caller's own session or
//   token included: sign in again with the new password. (The portal's form
//   does that for its browser: `changePasswordAction`.)

export function POST(request: Request) {
  return withContext(request, async (ctx) =>
    usersService.changeMyPassword(ctx, await readJson(request)),
  );
}
