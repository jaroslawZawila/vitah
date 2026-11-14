import bcrypt from "bcryptjs";
import {
  and,
  db,
  eq,
  isClientUser,
  isStaffUser,
  staffWithEmail,
  tenants,
  users,
  type SQL,
  type UserRole,
} from "@repo/db";
import { countSignIn, hashPassword, mfaService, normalizeEmail } from "@repo/core";

/** Staff sign in to the portal; clients sign in to the mobile app. */
export type Audience = "portal" | "mobile";

export type AuthenticatedUser = {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  tenantId: string;
};

/** The first user matching `where` who is active and whose tenant is active. */
export async function findActiveUser(where: SQL | undefined) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      role: users.role,
      tenantId: users.tenantId,
      passwordHash: users.passwordHash,
      passwordChangedAt: users.passwordChangedAt,
    })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(and(where, eq(users.active, true), eq(tenants.active, true)))
    .limit(1);
  return row;
}

/** The staff member, if they and their tenant are still active; their role is read fresh. */
export async function findActiveStaff(userId: string, tenantId: string) {
  return findActiveUser(and(eq(users.id, userId), eq(users.tenantId, tenantId), isStaffUser));
}

// A hash of a random password, with the same cost as real ones: compared
// against when the email is unknown, so a wrong email takes as long as a
// wrong password (no guessing which emails have accounts from the timing).
let dummyHash: Promise<string> | undefined;

/**
 * Returns the user when the email/password pair is valid for the audience and
 * both the user and their tenant are active. Otherwise returns null.
 */
export async function verifyCredentials(
  email: string,
  password: string,
  audience: Audience,
): Promise<AuthenticatedUser | null> {
  const address = normalizeEmail(email);
  const row = await findActiveUser(
    audience === "mobile"
      ? and(eq(users.email, address), isClientUser)
      : staffWithEmail(address),
  );

  const matches = await bcrypt.compare(
    password,
    row?.passwordHash ?? (await (dummyHash ??= hashPassword(crypto.randomUUID()))),
  );
  if (!row?.passwordHash || !matches) return null;

  const { passwordHash: _, passwordChangedAt: __, ...user } = row;
  return user;
}

/**
 * How long what a password change revoked still passes. The device that made
 * the change has requests under way with its old token or session (the app's
 * other calls; the portal page re-rendering in the very request that changed
 * it) before it holds the new one, and must not be thrown out by them.
 */
export const PASSWORD_CHANGE_GRACE_MS = 30 * 1000;

/**
 * Whether a session or token is revoked: the user's password was changed or
 * reset, or the account deactivated (`users.password_changed_at`), at or
 * after `issuedAt`, the moment (ms) it signed in or was issued, and
 * PASSWORD_CHANGE_GRACE_MS have passed since. The one rule for a portal
 * session (./session.ts), a staff Bearer token (./context.ts) and the app's
 * token (./mobile.ts).
 *
 * Exact to the millisecond: what was issued in the very instant of the change
 * goes too. What carries no issue time is older than any change.
 */
export function revokedByPasswordChange(
  issuedAt: number | undefined,
  passwordChangedAt: Date | null,
  now: number,
): boolean {
  if (passwordChangedAt === null) return false;
  const changedAt = passwordChangedAt.getTime();
  return (issuedAt ?? 0) <= changedAt && now - changedAt >= PASSWORD_CHANGE_GRACE_MS;
}

/**
 * A JWT's `iat` as the issue time `revokedByPasswordChange` takes. `iat` is in
 * whole seconds, so the token may have been issued at any moment of that
 * second: it counts as its end, and the token minted right after a password
 * change, in the same second, is kept.
 */
export function jwtIssuedAt(iat: number | undefined): number | undefined {
  return iat === undefined ? undefined : (iat + 1) * 1000;
}

const firstOf = (list: string | null | undefined) => list?.split(",")[0]?.trim() || undefined;
const lastOf = (list: string | null | undefined) => list?.split(",").at(-1)?.trim() || undefined;

/**
 * The caller's IP, which login throttling counts by (@repo/core/throttle).
 *
 * On Vercel the edge sets `x-vercel-forwarded-for` and `x-real-ip` itself,
 * overwriting whatever the client sent: they can't be forged.
 *
 * Anywhere else nothing vouches for these headers. We take `x-real-ip`, or
 * the LAST `x-forwarded-for` entry: the one the nearest proxy appended, not
 * the first, which is whatever the client claimed. That is right behind one
 * reverse proxy that sets them, and forgeable with none (or with one that
 * passes them through): a guesser could then claim a new address per attempt
 * and dodge the per-IP limits (never a password check). Hosting the portal
 * off Vercel means making this function read what that host guarantees.
 * Without any header (local dev) there is no IP: see the throttle's notes.
 */
export function clientIp(request: Request | undefined): string | undefined {
  const headers = request?.headers;
  if (!headers) return undefined;
  if (process.env.VERCEL) {
    return firstOf(headers.get("x-vercel-forwarded-for")) ?? firstOf(headers.get("x-real-ip"));
  }
  return firstOf(headers.get("x-real-ip")) ?? lastOf(headers.get("x-forwarded-for"));
}

/** A portal sign-in that went through: the user, and whether it passed two-step verification. */
export type PortalUser = AuthenticatedUser & { mfa: boolean };

/**
 * What a sign-in attempt came to, besides the user:
 * - `too_many_attempts`: the caller's IP is over its limits (password not looked at);
 * - `mfa_required`: the password is right and the account has two-step
 *   verification, but no code came with it: ask for one and try again;
 * - `invalid_code`: the password is right, the code is not (or was used already);
 * - null: the email or the password is wrong.
 */
export type SignInRefusal = "too_many_attempts" | "mfa_required" | "invalid_code" | null;

/**
 * `verifyCredentials` behind login throttling (the scheme is described in
 * @repo/core/throttle): an IP over its own limits gets "too_many_attempts"
 * whatever the password; failures from other IPs never refuse the right one.
 * A wrong password and an unknown email both answer null, and both count.
 *
 * The portal then asks staff with two-step verification for their code (the
 * app's clients have none). Both steps are this one call: `code` comes with
 * the email and the password, or not yet.
 *
 * What gives nothing away: the second step is only looked at once the
 * password is right. With a wrong password the answer is null, the same
 * whether the account has two-step verification or not, with or without a
 * code: nobody learns that an account has it without knowing its password.
 *
 * What counts: `mfa_required` is no failure (taken back off the counters, but
 * nothing is forgotten); a wrong code is one, on the very counters of a wrong
 * password, so codes are guessed no faster than passwords.
 */
export function attemptSignIn(
  email: string,
  password: string,
  audience: "mobile",
  ip: string | undefined,
): Promise<AuthenticatedUser | "too_many_attempts" | null>;
export function attemptSignIn(
  email: string,
  password: string,
  audience: Audience,
  ip: string | undefined,
  code?: string,
): Promise<AuthenticatedUser | PortalUser | SignInRefusal>;
export async function attemptSignIn(
  email: string,
  password: string,
  audience: Audience,
  ip: string | undefined,
  code?: string,
): Promise<AuthenticatedUser | PortalUser | SignInRefusal> {
  const attempt = await countSignIn(audience, normalizeEmail(email), ip);
  if (attempt.blocked) return "too_many_attempts";
  const user = await verifyCredentials(email, password, audience);
  if (!user) return null;
  if (audience === "mobile") {
    await attempt.succeeded();
    return user;
  }

  const second = await mfaService.checkSignInCode(user.id, code);
  if (second === "required") {
    await attempt.withdrawn();
    return "mfa_required";
  }
  if (second === "failed") return "invalid_code";
  await attempt.succeeded();
  return { ...user, mfa: second === "passed" };
}
