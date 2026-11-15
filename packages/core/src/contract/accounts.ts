// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

/**
 * The password rule for every account, staff and clients alike: at least
 * MIN_PASSWORD_LENGTH characters, with an uppercase letter and a number.
 * It is checked whenever a password is set (a new user or client, an admin's
 * reset, changing one's own) and never at sign-in: a password set under an
 * older, shorter rule keeps working until it is next changed. Nobody is
 * forced to change theirs.
 */
export const MIN_PASSWORD_LENGTH = 10;

export function isStrongPassword(password: string) {
  return password.length >= MIN_PASSWORD_LENGTH && /[A-Z]/.test(password) && /\d/.test(password);
}

/**
 * Error codes of a staff user changing their own password, or an admin
 * resetting someone's (`{ error: code }` in the API).
 */
export type PasswordError =
  | "missing_fields"
  | "wrong_password"
  | "too_many_attempts"
  | "weak_password"
  | "same_password"
  | "cannot_reset_own_password"
  | "not_found"
  | "forbidden";

// ─── Two-step verification (staff, portal) ───────────────────────────────

/** Recovery codes a user gets when two-step verification is switched on, each good once. */
export const MFA_RECOVERY_CODES = 10;

/** A staff user's two-step verification (GET /api/v1/me/mfa). */
export type MfaStatus = {
  /** On: signing in asks for a code after the password. */
  enabled: boolean;
  /** Recovery codes not spent yet. */
  recoveryCodesLeft: number;
};

/**
 * What a user needs to add the portal to their authenticator app (POST
 * /api/v1/me/mfa/begin). Shown once, while enrolling: never readable later.
 */
export type MfaEnrolment = {
  /** The secret in base32, to type by hand. */
  secret: string;
  /** The same as an `otpauth://` URI. */
  uri: string;
  /** That URI as a QR code: an SVG `data:` URL for an `<img>`. */
  qr: string;
};

/** The recovery codes, in the clear: answered once, when they are made. */
export type MfaRecoveryCodes = { recoveryCodes: string[] };

/** Error codes of the two-step verification endpoints (`{ error: code }`). */
export type MfaError =
  | "missing_fields"
  | "wrong_code"
  | "wrong_password"
  | "too_many_attempts"
  | "mfa_already_enabled"
  | "mfa_not_started"
  | "mfa_not_enabled"
  /** 503: its table isn't in the database yet (the portal deployed ahead of its SQL). */
  | "mfa_unavailable"
  | "cannot_remove_own_mfa"
  | "not_found"
  | "forbidden";
