import bcrypt from "bcryptjs";
import {
  and,
  db,
  eq,
  isClientUser,
  isStaffUser,
  tenants,
  users,
  type SQL,
  type UserRole,
} from "@repo/db";
import { normalizeEmail } from "@repo/core";

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
    })
    .from(users)
    .innerJoin(tenants, eq(tenants.id, users.tenantId))
    .where(and(where, eq(users.active, true), eq(tenants.active, true)))
    .limit(1);
  return row;
}

/**
 * Returns the user when the email/password pair is valid for the audience and
 * both the user and their tenant are active. Otherwise returns null.
 */
export async function verifyCredentials(
  email: string,
  password: string,
  audience: Audience,
): Promise<AuthenticatedUser | null> {
  const row = await findActiveUser(
    audience === "mobile"
      ? and(eq(users.email, normalizeEmail(email)), isClientUser)
      : and(eq(users.email, email), isStaffUser),
  );

  if (!row?.passwordHash) return null;
  if (!(await bcrypt.compare(password, row.passwordHash))) return null;

  const { passwordHash: _, ...user } = row;
  return user;
}
