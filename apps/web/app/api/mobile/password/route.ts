import { clientAccountService } from "@repo/core";
import { createMobileToken } from "@repo/auth/mobile";
import { readJson, withMobileClient } from "../../../../lib/api";

// ─── POST /api/mobile/password ────────────────────────────────────────────────
// Body: { currentPassword, newPassword } → { success: true, token }. The new
// password needs 10+ characters, an uppercase letter and a number. A wrong
// current password is 400 { error: "wrong_password" } (401 would sign the app
// out); after 10 wrong ones, 429 { error: "too_many_attempts" } for a while.
// The change signs every phone out: `token` keeps this one signed in (older
// app builds ignore it and sign in again).
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  return withMobileClient(request, async (client) => {
    await clientAccountService.changePassword(client.tenantId, client.sub, await readJson(request));
    return { success: true, token: await createMobileToken(client) };
  });
}
