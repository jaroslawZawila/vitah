import { SignJWT, jwtVerify } from "jose";
import { and, eq, isClientUser, users, type UserRole } from "@repo/db";
import { findActiveUser } from "./credentials";

/**
 * Requests with an old token still pass this long after a password change: the
 * phone that made the change may have others in flight before it gets its
 * fresh token (a 401 would sign it out).
 */
const PASSWORD_CHANGE_GRACE_MS = 30 * 1000;

/** Whether a token issued at `iat` (seconds) was revoked by the user's last password change. */
function revokedByPasswordChange(iat: number | undefined, passwordChangedAt: Date | null) {
  if (!passwordChangedAt || Date.now() - passwordChangedAt.getTime() < PASSWORD_CHANGE_GRACE_MS) {
    return false;
  }
  // `iat` has whole seconds: a token minted in the same second as the change is kept.
  return (iat ?? 0) < Math.floor(passwordChangedAt.getTime() / 1000);
}

export type MobileTokenPayload = {
  sub: string;
  email: string;
  name: string | null;
  role: UserRole;
  tenantId: string;
};

function getSecret(): Uint8Array {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error("NEXTAUTH_SECRET is not set");
  return new TextEncoder().encode(secret);
}

export async function createMobileToken(
  payload: MobileTokenPayload
): Promise<string> {
  return new SignJWT({
    email: payload.email,
    name: payload.name,
    role: payload.role,
    tenantId: payload.tenantId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(getSecret());
}

export async function verifyMobileToken(
  token: string
): Promise<MobileTokenPayload & { iat?: number }> {
  const { payload } = await jwtVerify(token, getSecret(), { algorithms: ["HS256"] });
  return {
    sub: payload.sub as string,
    email: payload.email as string,
    name: (payload.name as string | null) ?? null,
    role: payload.role as MobileTokenPayload["role"],
    tenantId: payload.tenantId as string,
    iat: payload.iat,
  };
}

/**
 * Authenticates a mobile API request from its `Authorization: Bearer` header.
 * Returns null unless the token is valid and still belongs to an active client
 * of an active tenant, and was issued after their last password change — so
 * deactivated clients, and phones signed in with an old password, lose access at once.
 */
export async function authenticateMobileRequest(
  request: Request
): Promise<MobileTokenPayload | null> {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return null;

  const verified = await verifyMobileToken(token).catch(() => null);
  if (!verified) return null;
  const { iat, ...payload } = verified;

  const client = await findActiveUser(
    and(eq(users.id, payload.sub), eq(users.tenantId, payload.tenantId), isClientUser)
  );
  if (!client || revokedByPasswordChange(iat, client.passwordChangedAt)) return null;

  return payload;
}

// ─── Social login (future) ────────────────────────────────────────────────────
// Add a function here that accepts an OAuth idToken from Google or Apple,
// validates it with the provider, looks up the client by email,
// and calls createMobileToken with the resolved payload.
// The API route at /api/mobile/auth/social stays minimal — all logic lives here.
// ─────────────────────────────────────────────────────────────────────────────
