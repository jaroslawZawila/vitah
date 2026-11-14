import { mfaService } from "@repo/core";
import { readJson, withContext } from "../../../../../../lib/api";

// POST /api/v1/me/mfa/confirm  body { code } → { recoveryCodes: string[10] }
//   The six digits the app shows for the secret of …/mfa/begin: two-step
//   verification is on from the next sign-in. The recovery codes are answered
//   this once. 400 { error } for missing_fields, wrong_code and
//   mfa_not_started; 409 mfa_already_enabled; 429 too_many_attempts after ten
//   wrong codes.

export function POST(request: Request) {
  return withContext(request, async (ctx) => mfaService.confirmEnrolment(ctx, await readJson(request)));
}
