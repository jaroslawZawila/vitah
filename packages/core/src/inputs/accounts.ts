import { z } from "zod";
import { APP_LANGUAGES, isStrongPassword } from "../contract";
import { MAX_TEXT } from "../input";
import { sentText, strongPassword, text } from "./fields";

// The bodies of signing in and of the accounts themselves: the portal's and
// the app's sign-in (@repo/auth, /api/mobile/auth), a password changed by its
// owner (../accounts, for staff and clients alike), the staff users and their
// own settings (../users) and two-step verification (../mfa).
//
// Sign-in and passwords answer exactly as before, in the same order: the
// throttle, the rule that a wrong password never tells whether two-step
// verification is on, and the app's error mapping depend on it. Where the old
// order put a check of several fields first, a never-failing schema is read
// first and the full one after it (`staffUserSchema`).
//
// The staff roles are written here, not imported from @repo/db: this file's
// types reach the app and the browser through ../contract, which must not pull
// the database schema in. packages/core/test/schema-values.test.ts fails when
// they differ from the schema's STAFF_ROLES.

export const STAFF_ROLE_WORDS = ["admin", "manager", "viewer"] as const;
const STAFF = STAFF_ROLE_WORDS;

/** A role a staff user may have (never "client"); `undefined` for anything else. */
const staffRole = z.enum(STAFF).optional().catch(undefined);

// ─── Signing in ──────────────────────────────────────────────────────────────

/**
 * The portal's credentials (@repo/auth's `authorize`): email and password as
 * they came (a form sends text), never trimmed, so a blank email still counts
 * as a failed sign-in; the code only when it is text. Missing or empty email
 * or password: no user (the caller's check).
 */
export const portalSignInSchema = z.object({
  email: z.custom<string>().optional(),
  password: z.custom<string>().optional(),
  code: sentText,
});

/**
 * The app's sign-in (POST /api/mobile/auth): the email trimmed, the password
 * as typed. Missing or empty: `email_and_password_required` (the route's check).
 */
export const mobileSignInSchema = z.object({ email: sentText.transform((email) => email?.trim()), password: sentText });

// ─── Passwords ───────────────────────────────────────────────────────────────

/** One's own password changed: the current one (not empty), then the new one, within the policy. */
export const passwordChangeSchema = z.object({
  currentPassword: z.string({ error: "missing_fields" }).min(1, { error: "missing_fields" }),
  newPassword: z.string({ error: "missing_fields" }).refine(isStrongPassword, { error: "weak_password" }),
});

/** A password set for someone else (an admin's reset, a client's app password). */
export const passwordSchema = z.object({ password: strongPassword });

// ─── Staff users ─────────────────────────────────────────────────────────────

/**
 * A new staff user, read first: the email lowercased, name and email `too_long`
 * past MAX_TEXT, the password as typed, the role if it is a staff one. What is
 * missing (`missing_fields`), a bad email (`invalid_email`) and then a weak
 * password (`weak_password`) are checked after, in that order.
 */
export const staffUserSchema = z.object({
  email: text(MAX_TEXT).transform((email) => email?.toLowerCase()),
  name: text(MAX_TEXT),
  password: sentText,
  role: staffRole,
});

/** A staff user's changes: each optional. */
export const staffUserChangesSchema = z.object({
  role: z.enum(STAFF, { error: "invalid_role" }).optional(),
  active: z.boolean({ error: "invalid_active" }).optional(),
});

/** The caller's own settings: the portal's language, null to follow the browser again. */
export const meChangesSchema = z.object({
  language: z.enum(APP_LANGUAGES, { error: "invalid_language" }).nullable().optional(),
});

// ─── Two-step verification ───────────────────────────────────────────────────

/** A code as typed (not trimmed); missing, not text or blank: `missing_fields`. */
const typedCode = z.string({ error: "missing_fields" }).refine((code) => code.trim() !== "", { error: "missing_fields" });

/** Confirming an enrolment, new recovery codes: the code the authenticator shows (or a recovery code). */
export const mfaCodeSchema = z.object({ code: typedCode });

/** Turning it off: a code and the current password. */
export const mfaDisableSchema = z.object({
  code: typedCode,
  password: z.string({ error: "missing_fields" }).min(1, { error: "missing_fields" }),
});

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** POST /api/mobile/auth, the app's sign-in. */
export type MobileSignInInput = z.input<typeof mobileSignInSchema>;
/** POST /api/v1/me/password, POST /api/mobile/password, changePasswordAction. */
export type PasswordChangeInput = z.input<typeof passwordChangeSchema>;
/** PUT /api/v1/users/:id/password, PUT /api/v1/clients/:id/password. */
export type PasswordInput = z.input<typeof passwordSchema>;
/** POST /api/v1/users. */
export type StaffUserInput = z.input<typeof staffUserSchema>;
/** PATCH /api/v1/users/:id. */
export type StaffUserChangesInput = z.input<typeof staffUserChangesSchema>;
/** PATCH /api/v1/me, setLanguageAction. */
export type MeChangesInput = z.input<typeof meChangesSchema>;
/** POST /api/v1/me/mfa/confirm and …/recovery-codes. */
export type MfaCodeInput = z.input<typeof mfaCodeSchema>;
/** POST /api/v1/me/mfa/disable. */
export type MfaDisableInput = z.input<typeof mfaDisableSchema>;
