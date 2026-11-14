import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import { and, db, eq, isNotNull, isNull, isStaffUser, userMfa, users, type MfaRecoveryCode } from "@repo/db";
import { passwordThrottle } from "./accounts";
import { requireAdmin, type Ctx } from "./context";
import { MFA_RECOVERY_CODES, type MfaEnrolment, type MfaRecoveryCodes, type MfaStatus } from "./contract";
import { CoreError, invalid, notFound } from "./errors";
import { logWarn } from "./log";
import { qrDataUrl } from "./mfa-qr";
import { isMissingTable } from "./pg-errors";
import { openSecret, sealSecret } from "./mfa-secret";
import { clearAttempts, overLimit, type ThrottleKey } from "./throttle";
import { base32Encode, generateTotpSecret, normalizeTotpCode, otpauthUri, TOTP_DIGITS, verifyTotp } from "./totp";

// Two-step verification for staff: a code from an authenticator app (TOTP,
// ./totp.ts) after the password. Optional, and each user's own to switch on:
//
//   begin    a new secret, kept encrypted (./mfa-secret.ts) on an unconfirmed
//            row, and shown once as a QR code and as text;
//   confirm  one valid code proves the app has it: only then is it on, and
//            the ten recovery codes are shown, once;
//   sign-in  `checkSignInCode`, called by @repo/auth after the password;
//   disable  with the password and a code; `regenerateRecoveryCodes` with a code;
//   an admin removes another user's (a lost phone): `removeUserMfa`.
//
// A "code" is, everywhere but when confirming, either the app's six digits or
// a recovery code. The app's code is good once (`last_step`), a recovery code
// once ever. The secret and the hashes never leave this module: nothing here
// returns or logs them after `begin`.
//
// Clients (the mobile app's users) have none: a `Ctx` is staff-only.

/** What authenticator apps list the account under. */
const ISSUER = "ViTAH";

/** Wrong codes a signed-in user may enter per throttle window (confirming, disabling, new recovery codes). */
const CODE_ATTEMPTS = 10;
const codeThrottle = (userId: string): ThrottleKey => ({ key: `mfa:${userId}`, limit: CODE_ATTEMPTS });

const tooManyAttempts = () => new CoreError("too_many_attempts", 429);

// ─── Recovery codes ──────────────────────────────────────────────────────────
// Ten random codes of 50 bits each, shown as XXXXX-XXXXX. Random and long, so
// a salted SHA-256 is enough to keep them (there is nothing to guess faster
// than at random; bcrypt would only slow every sign-in ten times over).

const RECOVERY_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no I, O, 0, 1: read aloud or copied by hand
const RECOVERY_CODE_CHARS = 10;

/** A recovery code as typed: any case, with or without its dash or spaces. */
const normalizeRecoveryCode = (code: string) => code.toUpperCase().replace(/[\s-]/g, "");

const hashRecoveryCode = (salt: string, code: string) =>
  createHash("sha256").update(Buffer.from(salt, "hex")).update(normalizeRecoveryCode(code)).digest();

function newRecoveryCodes(): { plain: string[]; stored: MfaRecoveryCode[] } {
  const plain = Array.from({ length: MFA_RECOVERY_CODES }, () => {
    // 32 symbols: each byte's low five bits pick one, without bias.
    const chars = Array.from(randomBytes(RECOVERY_CODE_CHARS), (byte) => RECOVERY_ALPHABET[byte & 31]).join("");
    return `${chars.slice(0, 5)}-${chars.slice(5)}`;
  });
  const stored = plain.map((code) => {
    const salt = randomBytes(16).toString("hex");
    return { salt, hash: hashRecoveryCode(salt, code).toString("hex"), usedAt: null };
  });
  return { plain, stored };
}

/** The position of the unspent recovery code `typed` is, or -1. Every code is compared, each in constant time. */
function findRecoveryCode(codes: MfaRecoveryCode[], typed: string): number {
  let found = -1;
  codes.forEach((code, index) => {
    const matches = timingSafeEqual(hashRecoveryCode(code.salt, typed), Buffer.from(code.hash, "hex"));
    if (matches && code.usedAt === null && found === -1) found = index;
  });
  return found;
}

const unspent = (codes: MfaRecoveryCode[]) => codes.filter((code) => code.usedAt === null).length;

// ─── Before its table ────────────────────────────────────────────────────────
// The portal may be deployed ahead of packages/db/sql/2026-11-14-1710-user-mfa.sql.
// Until the table is there nobody can have enrolled: signing in goes on as
// without two-step verification (`checkSignInCode`), the staff list says "off"
// for everyone (./users.ts), and everything else here answers 503
// `mfa_unavailable` rather than failing. Each time, a warning says so.

/** The table's name in the database, as an error about it spells it. */
const MFA_TABLE = "user_mfa";

/** Whether `error` is the database saying `user_mfa` isn't there; then it is logged (`mfa.table_missing`). */
export function mfaTableMissing(error: unknown): boolean {
  if (!isMissingTable(error, MFA_TABLE)) return false;
  logWarn("mfa.table_missing", error);
  return true;
}

/** `fn`'s answer; 503 `mfa_unavailable` when two-step verification's table isn't there yet. */
async function available<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (error) {
    if (mfaTableMissing(error)) throw new CoreError("mfa_unavailable", 503);
    throw error;
  }
}

// ─── Checking a code ─────────────────────────────────────────────────────────

type MfaRow = Pick<typeof userMfa.$inferSelect, "userId" | "secret" | "lastStep" | "recoveryCodes">;

/** Longer than any code, however it is typed (spaces, dashes). */
const MAX_CODE_LENGTH = 64;

const isAppCode = (code: string) => new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(normalizeTotpCode(code));

/** The step the authenticator's `code` is right for, never one already used; null otherwise. */
function acceptedStep(row: MfaRow, code: string, now: Date): number | null {
  const secret = openSecret(row.secret, row.userId);
  if (!secret) {
    // Sealed under another NEXTAUTH_SECRET (see ./mfa-secret.ts): no code can be right.
    logWarn("mfa.secret_unreadable", undefined, { userId: row.userId });
    return null;
  }
  const step = verifyTotp(secret, code, now.getTime());
  if (step === null || (row.lastStep !== null && step <= row.lastStep)) return null;
  return step;
}

/**
 * What accepting `code` changes on the row: the step of the app's code (so it
 * is refused next time), or the recovery code spent. Null when the code is
 * not right, or was used already.
 */
function accepted(row: MfaRow, code: string, now: Date): Partial<typeof userMfa.$inferInsert> | null {
  // No code is this long: nothing a caller sends is hashed ten times over at any length.
  if (code.length > MAX_CODE_LENGTH) return null;
  if (isAppCode(code)) {
    const step = acceptedStep(row, code, now);
    return step === null ? null : { lastStep: step };
  }
  const index = findRecoveryCode(row.recoveryCodes, code);
  if (index === -1) return null;
  return {
    recoveryCodes: row.recoveryCodes.map((entry, i) => (i === index ? { ...entry, usedAt: now.toISOString() } : entry)),
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The user's confirmed row, locked: two requests can't both spend the same code. */
async function lockConfirmed(tx: Tx, userId: string): Promise<MfaRow | undefined> {
  const [row] = await tx
    .select({
      userId: userMfa.userId,
      secret: userMfa.secret,
      lastStep: userMfa.lastStep,
      recoveryCodes: userMfa.recoveryCodes,
    })
    .from(userMfa)
    .where(and(eq(userMfa.userId, userId), isNotNull(userMfa.confirmedAt)))
    .for("update");
  return row;
}

/** Spends `code` for the user with two-step verification on; false if it is not right (nothing changes). */
async function spendCode(tx: Tx, userId: string, code: string, now: Date): Promise<boolean | "off"> {
  const row = await lockConfirmed(tx, userId);
  if (!row) return "off";
  const change = accepted(row, code, now);
  if (!change) return false;
  await tx.update(userMfa).set({ ...change, updatedAt: now }).where(eq(userMfa.userId, userId));
  return true;
}

// ─── Sign-in (called by @repo/auth, after the password was found right) ──────

/**
 * - `off`: the user has no two-step verification (never enrolled, or never confirmed);
 * - `required`: they have, and no code came with the password;
 * - `passed`: the code was right, and is now spent;
 * - `failed`: it was not (wrong, expired, or used before).
 */
export type SecondStep = "off" | "required" | "passed" | "failed";

/**
 * The second step of a portal sign-in. Only ever called once the password is
 * known to be right: what it answers says whether the account has two-step
 * verification, which nobody without the password may learn.
 */
export async function checkSignInCode(userId: string, code: string | undefined, now = new Date()): Promise<SecondStep> {
  let enrolled: { userId: string }[];
  try {
    enrolled = await db
      .select({ userId: userMfa.userId })
      .from(userMfa)
      .where(and(eq(userMfa.userId, userId), isNotNull(userMfa.confirmedAt)));
  } catch (error) {
    // Without the table (see `mfaTableMissing`) nobody can have enrolled, and signing in must not stop.
    if (!mfaTableMissing(error)) throw error;
    return "off";
  }
  if (enrolled.length === 0) return "off";
  if (!code?.trim()) return "required";
  const spent = await db.transaction((tx) => spendCode(tx, userId, code, now));
  // Removed between the two reads (by an admin): as if it had never been on.
  if (spent === "off") return "off";
  return spent ? "passed" : "failed";
}

// ─── The user's own settings ─────────────────────────────────────────────────

/** The caller's own account: they must still be active staff of their tenant. */
async function me(ctx: Ctx) {
  const [user] = await db
    .select({ email: users.email, passwordHash: users.passwordHash })
    .from(users)
    .where(and(eq(users.id, ctx.userId), eq(users.tenantId, ctx.tenantId), eq(users.active, true), isStaffUser));
  if (!user) throw notFound();
  return user;
}

const mine = (ctx: Ctx) => and(eq(userMfa.userId, ctx.userId), eq(userMfa.tenantId, ctx.tenantId));

/** Whether the caller has two-step verification on, and the recovery codes they have left. */
export async function getStatus(ctx: Ctx): Promise<MfaStatus> {
  const [row] = await available(() =>
    db.select({ confirmedAt: userMfa.confirmedAt, recoveryCodes: userMfa.recoveryCodes }).from(userMfa).where(mine(ctx)),
  );
  const enabled = !!row?.confirmedAt;
  return { enabled, recoveryCodesLeft: enabled ? unspent(row!.recoveryCodes) : 0 };
}

/**
 * Starts enrolling: a new secret, to add to an authenticator app. Nothing
 * changes at sign-in until `confirmEnrolment`. Starting again replaces the
 * secret of an enrolment never confirmed. 409 `mfa_already_enabled` once on:
 * it must be turned off first (which needs the password and a code).
 */
export async function beginEnrolment(ctx: Ctx): Promise<MfaEnrolment> {
  const { email } = await me(ctx);
  const secret = generateTotpSecret();
  const now = new Date();
  const fresh = { secret: sealSecret(secret, ctx.userId), recoveryCodes: [], lastStep: null, createdAt: now, updatedAt: now };
  const started = await available(() =>
    db
      .insert(userMfa)
      .values({ userId: ctx.userId, tenantId: ctx.tenantId, ...fresh })
      .onConflictDoUpdate({ target: userMfa.userId, set: fresh, setWhere: isNull(userMfa.confirmedAt) })
      .returning({ userId: userMfa.userId }),
  );
  if (started.length === 0) throw new CoreError("mfa_already_enabled", 409);

  const uri = otpauthUri(ISSUER, email, secret);
  return { secret: base32Encode(secret), uri, qr: qrDataUrl(uri) };
}

/** The `code` of a request body, if one was typed. */
const typedCode = (input: Record<string, unknown>) =>
  typeof input.code === "string" && input.code.trim() ? input.code : undefined;

/**
 * Body: { code } — the six digits the app shows for the secret `beginEnrolment`
 * gave. Right: two-step verification is on from the next sign-in, and the
 * recovery codes are answered, this once. Wrong (`wrong_code`): nothing is on.
 * `too_many_attempts` (429) after ten wrong codes.
 */
export async function confirmEnrolment(ctx: Ctx, input: Record<string, unknown>, now = new Date()): Promise<MfaRecoveryCodes> {
  const code = typedCode(input);
  if (!code) throw invalid("missing_fields");
  await me(ctx);
  const throttle = [codeThrottle(ctx.userId)];
  if (await overLimit(throttle)) throw tooManyAttempts();

  const codes = newRecoveryCodes();
  await available(() =>
    db.transaction(async (tx) => {
      const [row] = await tx.select().from(userMfa).where(mine(ctx)).for("update");
      if (!row) throw invalid("mfa_not_started");
      if (row.confirmedAt) throw new CoreError("mfa_already_enabled", 409);
      // The app's code only: there are no recovery codes yet.
      const step = isAppCode(code) ? acceptedStep(row, code, now) : null;
      if (step === null) throw invalid("wrong_code");
      await tx
        .update(userMfa)
        .set({ confirmedAt: now, lastStep: step, recoveryCodes: codes.stored, updatedAt: now })
        .where(eq(userMfa.userId, ctx.userId));
    }),
  );
  await clearAttempts(throttle);
  return { recoveryCodes: codes.plain };
}

/** 400 `mfa_not_enabled` unless the caller has two-step verification on. */
async function requireEnabled(ctx: Ctx) {
  if (!(await getStatus(ctx)).enabled) throw invalid("mfa_not_enabled");
}

/**
 * Body: { password, code } — turns the caller's two-step verification off.
 * Needs their current password (`wrong_password`) and a code, the app's or a
 * recovery one (`wrong_code`). `too_many_attempts` (429) after ten wrong ones.
 */
export async function disable(ctx: Ctx, input: Record<string, unknown>, now = new Date()) {
  const code = typedCode(input);
  const { password } = input;
  if (!code || typeof password !== "string" || !password) throw invalid("missing_fields");
  const user = await me(ctx);
  await requireEnabled(ctx);
  // A wrong password here counts with those of "change my password": one allowance for both.
  const throttle = [passwordThrottle(ctx.userId), codeThrottle(ctx.userId)];
  if (await overLimit(throttle)) throw tooManyAttempts();

  if (!user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) throw invalid("wrong_password");
  await db.transaction(async (tx) => {
    const spent = await spendCode(tx, ctx.userId, code, now);
    if (spent === "off") throw invalid("mfa_not_enabled");
    if (!spent) throw invalid("wrong_code");
    await tx.delete(userMfa).where(mine(ctx));
  });
  await clearAttempts(throttle);
  return { success: true };
}

/**
 * Body: { code } — new recovery codes, answered this once; the old ones stop
 * working, spent or not. Needs a code, the app's or one of the old recovery
 * ones (`wrong_code`).
 */
export async function regenerateRecoveryCodes(ctx: Ctx, input: Record<string, unknown>, now = new Date()): Promise<MfaRecoveryCodes> {
  const code = typedCode(input);
  if (!code) throw invalid("missing_fields");
  await me(ctx);
  await requireEnabled(ctx);
  const throttle = [codeThrottle(ctx.userId)];
  if (await overLimit(throttle)) throw tooManyAttempts();

  const codes = newRecoveryCodes();
  await db.transaction(async (tx) => {
    const spent = await spendCode(tx, ctx.userId, code, now);
    if (spent === "off") throw invalid("mfa_not_enabled");
    if (!spent) throw invalid("wrong_code");
    await tx.update(userMfa).set({ recoveryCodes: codes.stored, updatedAt: now }).where(mine(ctx));
  });
  await clearAttempts(throttle);
  return { recoveryCodes: codes.plain };
}

// ─── Admins ──────────────────────────────────────────────────────────────────

/**
 * An admin removes another staff user's two-step verification, for when their
 * phone is lost: they then sign in with the password alone and may enrol
 * again. Every session they have ends (`password_changed_at`, as after a
 * password reset: whoever holds the lost phone may hold a session too). Not
 * for the admin's own (`cannot_remove_own_mfa`): that is `disable`, with the
 * password and a code. 404 for anyone outside the tenant's staff;
 * `mfa_not_enabled` if there is none to remove.
 */
export async function removeUserMfa(ctx: Ctx, userId: string) {
  requireAdmin(ctx);
  if (userId === ctx.userId) throw invalid("cannot_remove_own_mfa");

  return available(() =>
    db.transaction(async (tx) => {
      const target = and(eq(users.id, userId), eq(users.tenantId, ctx.tenantId), isStaffUser);
      const [user] = await tx.select({ id: users.id }).from(users).where(target).for("update");
      if (!user) throw notFound();
      const removed = await tx
        .delete(userMfa)
        .where(and(eq(userMfa.userId, userId), eq(userMfa.tenantId, ctx.tenantId), isNotNull(userMfa.confirmedAt)))
        .returning({ userId: userMfa.userId });
      if (removed.length === 0) throw invalid("mfa_not_enabled");
      const now = new Date();
      await tx.update(users).set({ passwordChangedAt: now, updatedAt: now }).where(target);
      return { id: userId };
    }),
  );
}
