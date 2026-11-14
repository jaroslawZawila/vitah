import { mfaService } from "@repo/core";
import { readJson, withContext } from "../../../../../../lib/api";

// POST /api/v1/me/mfa/disable  body { password, code } → { success: true }
//   Turns the caller's two-step verification off: needs their current
//   password and a code, the app's or a recovery one. 400 { error } for
//   missing_fields, wrong_password, wrong_code and mfa_not_enabled; 429
//   too_many_attempts after ten wrong tries.

export function POST(request: Request) {
  return withContext(request, async (ctx) => mfaService.disable(ctx, await readJson(request)));
}
