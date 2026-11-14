import type { Ctx } from "@repo/core";
import type { UserRole as AnyUserRole } from "@repo/db";
import { findActiveStaff, jwtIssuedAt, revokedByPasswordChange } from "./credentials";
import { auth } from "./index";
import { verifyMobileToken } from "./mobile";

/**
 * Builds a staff `Ctx`. Clients (mobile app homeowners) never get one: they
 * may only use their own /api/mobile/* endpoints, never tenant-wide APIs.
 */
function staffContext(tenantId: string, userId: string, role: AnyUserRole): Ctx | null {
  return role === "client" ? null : { tenantId, userId, role };
}

/**
 * Resolves the caller for an API request.
 * - `Authorization: Bearer <token>` → mobile JWT (see ./mobile.ts), checked
 *   against the database: the user must still be active staff, the token
 *   not revoked by a password change since it was issued (the same rule as
 *   a portal session, `revokedByPasswordChange`), and their current role
 *   applies, not the token's
 * - otherwise → NextAuth session cookie (portal)
 * Returns null when the caller is not authenticated.
 */
export async function getRequestContext(request: Request): Promise<Ctx | null> {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    try {
      const payload = await verifyMobileToken(header.slice(7).trim());
      const user = await findActiveStaff(payload.sub, payload.tenantId);
      if (!user || revokedByPasswordChange(jwtIssuedAt(payload.iat), user.passwordChangedAt, Date.now())) return null;
      return staffContext(user.tenantId, user.id, user.role);
    } catch {
      return null;
    }
  }
  return getSessionContext();
}

/**
 * Context from the NextAuth session (server actions, RSC). The session's role
 * is current, and a session from before the user's password changed is
 * gone: the `jwt` callback re-reads the user (./session.ts).
 */
export async function getSessionContext(): Promise<Ctx | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.tenantId || !user.role) return null;
  return staffContext(user.tenantId, user.id, user.role);
}
