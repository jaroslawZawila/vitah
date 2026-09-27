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
import { clearAttempts, hashPassword, normalizeEmail, overLimit } from "@repo/core";

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
 * Failed sign-ins allowed per window: for an email from one IP (so a stranger
 * guessing elsewhere can't lock its owner out), for an email from anywhere (a
 * botnet), and from one IP across emails.
 */
export const SIGN_IN_LIMITS = { emailFromIp: 10, email: 100, ip: 100 };

/** The caller's IP, as set by Vercel's edge (clients can't forge x-real-ip there). */
export function clientIp(request: Request | undefined): string | undefined {
  const headers = request?.headers;
  return (
    headers?.get("x-real-ip")?.trim() ||
    headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    undefined
  );
}

/**
 * `verifyCredentials` behind login throttling: once the email or the IP is
 * over its limit, answers "too_many_attempts" without checking the password.
 */
export async function attemptSignIn(
  email: string,
  password: string,
  audience: Audience,
  ip: string | undefined,
): Promise<AuthenticatedUser | "too_many_attempts" | null> {
  const address = normalizeEmail(email);
  const emailKeys = [
    { key: `signin:${audience}:${address}:${ip ?? "unknown"}`, limit: SIGN_IN_LIMITS.emailFromIp },
    { key: `signin:${audience}:${address}`, limit: SIGN_IN_LIMITS.email },
  ];
  const keys = ip ? [...emailKeys, { key: `signin-ip:${ip}`, limit: SIGN_IN_LIMITS.ip }] : emailKeys;

  if (await overLimit(keys)) return "too_many_attempts";
  const user = await verifyCredentials(email, password, audience);
  // The IP's count stays: signing in to one account mustn't reset guessing at others.
  if (user) await clearAttempts(emailKeys);
  return user;
}
