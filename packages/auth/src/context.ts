import type { Ctx } from "@repo/core";
import { auth } from "./index";
import { verifyMobileToken } from "./mobile";

/**
 * Resolves the caller for an API request.
 * - `Authorization: Bearer <token>` → mobile JWT (see ./mobile.ts)
 * - otherwise → NextAuth session cookie (portal)
 * Returns null when the caller is not authenticated.
 */
export async function getRequestContext(request: Request): Promise<Ctx | null> {
  const header = request.headers.get("authorization");
  if (header?.toLowerCase().startsWith("bearer ")) {
    try {
      const payload = await verifyMobileToken(header.slice(7).trim());
      return { tenantId: payload.tenantId, userId: payload.sub, role: payload.role };
    } catch {
      return null;
    }
  }
  return getSessionContext();
}

/** Context from the NextAuth session (server actions, RSC). */
export async function getSessionContext(): Promise<Ctx | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.tenantId || !user.role) return null;
  return { tenantId: user.tenantId, userId: user.id, role: user.role };
}
