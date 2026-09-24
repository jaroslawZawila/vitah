import { SignJWT, jwtVerify } from "jose";
import { and, eq, isClientUser, users, type UserRole } from "@repo/db";
import { findActiveUser } from "./credentials";

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
): Promise<MobileTokenPayload> {
  const { payload } = await jwtVerify(token, getSecret());
  return {
    sub: payload.sub as string,
    email: payload.email as string,
    name: (payload.name as string | null) ?? null,
    role: payload.role as MobileTokenPayload["role"],
    tenantId: payload.tenantId as string,
  };
}

/**
 * Authenticates a mobile API request from its `Authorization: Bearer` header.
 * Returns null unless the token is valid and still belongs to an active client
 * of an active tenant, so revoked or deactivated clients lose access at once.
 */
export async function authenticateMobileRequest(
  request: Request
): Promise<MobileTokenPayload | null> {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) return null;

  let payload: MobileTokenPayload;
  try {
    payload = await verifyMobileToken(token);
  } catch {
    return null;
  }

  const client = await findActiveUser(
    and(eq(users.id, payload.sub), eq(users.tenantId, payload.tenantId), isClientUser)
  );

  return client ? payload : null;
}

// ─── Social login (future) ────────────────────────────────────────────────────
// Add a function here that accepts an OAuth idToken from Google or Apple,
// validates it with the provider, looks up the client by email,
// and calls createMobileToken with the resolved payload.
// The API route at /api/mobile/auth/social stays minimal — all logic lives here.
// ─────────────────────────────────────────────────────────────────────────────
