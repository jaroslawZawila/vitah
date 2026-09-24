import { db, users, eq, and, isStaffUser, STAFF_ROLES } from "@repo/db";
import { hashPassword } from "./accounts";
import { requireAdmin, type Ctx, type UserRole } from "./context";
import { MIN_PASSWORD_LENGTH } from "./contract";
import { invalid, notFound } from "./errors";

// Staff management within the caller's tenant. Admin only. Clients (mobile
// app users) are managed from their project (./project-client.ts).

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function role(value: unknown): UserRole | undefined {
  return STAFF_ROLES.includes(value as UserRole) ? (value as UserRole) : undefined;
}

export async function listUsers(ctx: Ctx) {
  requireAdmin(ctx);
  const staff = await db.query.users.findMany({
    where: and(eq(users.tenantId, ctx.tenantId), isStaffUser),
    columns: {
      id: true,
      name: true,
      email: true,
      role: true,
      active: true,
      createdAt: true,
    },
    orderBy: (users, { asc }) => [asc(users.createdAt)],
  });
  // Narrows the role type; the query already excludes clients.
  return staff.filter((u): u is typeof u & { role: UserRole } => u.role !== "client");
}

export type UserListItem = Awaited<ReturnType<typeof listUsers>>[number];

/** Body: { email, name, password, role } */
export async function createUser(ctx: Ctx, input: Record<string, unknown>) {
  requireAdmin(ctx);

  const email = str(input.email);
  const name = str(input.name);
  // Passwords are not trimmed
  const password =
    typeof input.password === "string" ? input.password : undefined;
  const userRole = role(input.role);

  if (!email || !name || !password || !userRole)
    throw invalid("missing_fields");
  if (password.length < MIN_PASSWORD_LENGTH) throw invalid("password_too_short");

  const existing = await db.query.users.findFirst({
    where: and(eq(users.tenantId, ctx.tenantId), eq(users.email, email)),
    columns: { id: true },
  });
  if (existing) throw invalid("email_exists");

  const [created] = await db
    .insert(users)
    .values({
      tenantId: ctx.tenantId,
      email,
      name,
      passwordHash: await hashPassword(password),
      role: userRole,
    })
    .returning({ id: users.id });

  if (!created) throw new Error("User insert returned no row");
  return { id: created.id };
}

/** Body: { role?, active? } */
export async function updateUser(
  ctx: Ctx,
  userId: string,
  input: Record<string, unknown>,
) {
  requireAdmin(ctx);

  const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (input.role !== undefined) {
    const userRole = role(input.role);
    if (!userRole) throw invalid("invalid_role");
    set.role = userRole;
  }
  if (input.active !== undefined) {
    if (typeof input.active !== "boolean") throw invalid("invalid_active");
    set.active = input.active;
  }

  // An admin can't demote or deactivate themselves — that could leave the
  // tenant without anyone able to manage users.
  if (
    userId === ctx.userId &&
    ((set.role !== undefined && set.role !== "admin") || set.active === false)
  ) {
    throw invalid("cannot_modify_self");
  }

  const removesAdmin =
    (set.role !== undefined && set.role !== "admin") || set.active === false;

  return db.transaction(async (tx) => {
    // The tenant must keep at least one active admin. Lock the active admin
    // rows so two concurrent demotions can't both pass the check.
    if (removesAdmin) {
      const activeAdmins = await tx
        .select({ id: users.id })
        .from(users)
        .where(
          and(
            eq(users.tenantId, ctx.tenantId),
            eq(users.role, "admin"),
            eq(users.active, true),
          ),
        )
        .for("update");
      const isActiveAdmin = activeAdmins.some((a) => a.id === userId);
      if (isActiveAdmin && activeAdmins.length === 1) {
        throw invalid("last_admin");
      }
    }

    const updated = await tx
      .update(users)
      .set(set)
      .where(and(eq(users.id, userId), eq(users.tenantId, ctx.tenantId), isStaffUser))
      .returning({ id: users.id });
    if (updated.length === 0) throw notFound();

    return { id: userId };
  });
}
