import { mfaService } from "@repo/core";
import { withContext } from "../../../../../../lib/api";

// POST /api/v1/me/mfa/begin → { secret, uri, qr }
//   A new secret for the caller's authenticator app: in base32, as an
//   `otpauth://` URI and as a QR code (an SVG data URL). Nothing changes at
//   sign-in until …/mfa/confirm; calling again replaces a secret not confirmed.
//   409 mfa_already_enabled once it is on.

export function POST(request: Request) {
  return withContext(request, (ctx) => mfaService.beginEnrolment(ctx));
}
