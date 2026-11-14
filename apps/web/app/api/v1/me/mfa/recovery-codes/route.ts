import { mfaService } from "@repo/core";
import { readJson, withContext } from "../../../../../../lib/api";

// POST /api/v1/me/mfa/recovery-codes  body { code } → { recoveryCodes: string[10] }
//   New recovery codes, answered this once; the old ones stop working. Needs
//   a code, the app's or an old recovery one. 400 { error } for
//   missing_fields, wrong_code and mfa_not_enabled; 429 too_many_attempts.

export function POST(request: Request) {
  return withContext(request, async (ctx) => mfaService.regenerateRecoveryCodes(ctx, await readJson(request)));
}
