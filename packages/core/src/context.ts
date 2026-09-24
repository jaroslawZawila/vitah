export type UserRole = "admin" | "manager" | "viewer";

/**
 * Who is making the call. Every core function takes this as its first
 * argument and scopes all queries to `tenantId`.
 *
 * Built by the transport layer: from the NextAuth session (portal server
 * actions) or from the Bearer token (/api/v1 route handlers).
 */
export type Ctx = {
  tenantId: string;
  userId: string;
  role: UserRole;
};
