import { clientAccountService } from "@repo/core";
import { readJson, withMobileClient } from "../../../../lib/api";

// ─── POST /api/mobile/password ────────────────────────────────────────────────
// Body: { currentPassword, newPassword } → { success: true }. The new password
// needs 10+ characters, an uppercase letter and a number. A wrong current
// password is 400 { error: "wrong_password" } (401 would sign the app out).
// ─────────────────────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  return withMobileClient(request, async (client) =>
    clientAccountService.changePassword(client.tenantId, client.sub, await readJson(request)),
  );
}
