import type { JWT } from "next-auth/jwt";
import { findActiveStaff, revokedByPasswordChange } from "./credentials";

/**
 * How long a session's user check holds. A deactivation, a role change and a
 * password change or reset (which signs the user's sessions out) all apply
 * within it: a minute at most after the change, a session from before it is gone.
 */
export const SESSION_RECHECK_MS = 60 * 1000;

/**
 * The token of a session that has just signed in with its password, as `user`.
 * `authAt` is when: our own claim and not the JWT's `iat`, which NextAuth
 * renews every time it rewrites the cookie. `mfa` says it also passed two-step
 * verification: set here only, from what `authorize` answered (never from
 * the token coming in), and carried unchanged for the session's life.
 */
export function signedInToken(
  token: JWT,
  user: Pick<JWT, "role" | "tenantId" | "mfa">,
  now = Date.now(),
): JWT {
  const { mfa: _, ...rest } = token;
  return {
    ...rest,
    role: user.role,
    tenantId: user.tenantId,
    ...(user.mfa === true ? { mfa: true } : {}),
    checkedAt: now,
    authAt: now,
  };
}

/**
 * A portal session token on a later use: re-reads the user when the last
 * check is older than SESSION_RECHECK_MS, so a deactivated user (or tenant),
 * or one whose password changed after this session signed in, is signed out
 * (null), and a changed role applies, within a minute.
 *
 * A session from before the change still passes for PASSWORD_CHANGE_GRACE_MS
 * after it (`revokedByPasswordChange`), but that is not noted as a check: it
 * is looked up again on every use, so the minute still holds (the grace is
 * shorter than the re-check).
 */
export async function refreshSessionToken(token: JWT, now = Date.now()): Promise<JWT | null> {
  if (token.checkedAt && now - token.checkedAt < SESSION_RECHECK_MS) return token;
  const current =
    token.sub && token.tenantId ? await findActiveStaff(token.sub, token.tenantId) : undefined;
  if (!current) return null;
  const revokedAt = (time: number) => revokedByPasswordChange(token.authAt, current.passwordChangedAt, time);
  if (revokedAt(now)) return null;
  // Not yet, but it will be once the grace is over: passes as it is until then.
  if (revokedAt(Infinity)) return token;
  return { ...token, role: current.role, checkedAt: now };
}
