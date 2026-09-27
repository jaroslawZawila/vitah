import type { JWT } from "next-auth/jwt";
import { findActiveStaff } from "./credentials";

/** How long a session's user check holds; deactivations and role changes apply within it. */
export const SESSION_RECHECK_MS = 60 * 1000;

/**
 * A portal session token on a later use: re-reads the user when the last
 * check is older than SESSION_RECHECK_MS, so a deactivated user (or tenant)
 * is signed out (null) and a changed role applies within a minute.
 */
export async function refreshSessionToken(token: JWT, now = Date.now()): Promise<JWT | null> {
  if (token.checkedAt && now - token.checkedAt < SESSION_RECHECK_MS) return token;
  const current =
    token.sub && token.tenantId ? await findActiveStaff(token.sub, token.tenantId) : undefined;
  return current ? { ...token, role: current.role, checkedAt: now } : null;
}
