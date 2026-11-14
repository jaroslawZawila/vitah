import { db, users, userMfa, and, asc, eq, isStaffUser, sql, STAFF_ROLES } from "@repo/db";
import {
  changeOwnPassword,
  EMAIL_PATTERN,
  hashPassword,
  isUniqueViolation,
  newPassword,
  replacePassword,
} from "./accounts";
import { requireAdmin, type Ctx, type UserRole } from "./context";
import { isAppLanguage } from "./contract";
import { invalid, notFound } from "./errors";
import { MAX_TEXT, text } from "./input";
import { mfaTableMissing } from "./mfa";

// Staff management within the caller's tenant. Admin only. Clients (mobile
// app users) are managed from their project (./project-client.ts). Except
// `getMe` / `updateMe` / `changeMyPassword`: every staff user's own settings.

function role(value: unknown): UserRole | undefined {
  return STAFF_ROLES.includes(value as UserRole) ? (value as UserRole) : undefined;
}

export async function listUsers(ctx: Ctx) {
  requireAdmin(ctx);
  const columns = { id: users.id, name: users.name, email: users.email, role: users.role, active: users.active, createdAt: users.createdAt };
  const ofTenant = and(eq(users.tenantId, ctx.tenantId), isStaffUser);
  const staff = await db
    // Whether signing in asks them for a code too (./mfa.ts): on or off, nothing else of it.
    .select({ ...columns, mfaEnabled: sql<boolean>`${userMfa.confirmedAt} is not null` })
    .from(users)
    .leftJoin(userMfa, eq(userMfa.userId, users.id))
    .where(ofTenant)
    .orderBy(asc(users.createdAt))
    .catch(async (error: unknown) => {
      // Before two-step verification's table is there (./mfa.ts), nobody has it on.
      if (!mfaTableMissing(error)) throw error;
      const rows = await db.select(columns).from(users).where(ofTenant).orderBy(asc(users.createdAt));
      return rows.map((user) => ({ ...user, mfaEnabled: false }));
    });
  // Narrows the role type; the query already excludes clients.
  return staff.filter((u): u is typeof u & { role: UserRole } => u.role !== "client");
}

export type UserListItem = Awaited<ReturnType<typeof listUsers>>[number];

/**
 * Body: { email, name, password, role }. The portal login finds staff by
 * email alone, so a staff email is unique across tenants (any case). The
 * password must meet the policy (`weak_password` otherwise).
 */
export async function createUser(ctx: Ctx, input: Record<string, unknown>) {
  requireAdmin(ctx);

  const email = text(input.email, MAX_TEXT)?.toLowerCase();
  const name = text(input.name, MAX_TEXT);
  // Passwords are not trimmed
  const password =
    typeof input.password === "string" ? input.password : undefined;
  const userRole = role(input.role);

  if (!email || !name || !password || !userRole)
    throw invalid("missing_fields");
  if (!EMAIL_PATTERN.test(email)) throw invalid("invalid_email");
  newPassword(password);

  try {
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
  } catch (error) {
    // Staff anywhere (users_staff_email_unique), or a client of this tenant.
    if (isUniqueViolation(error)) throw invalid("email_exists");
    throw error;
  }
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
    // Deactivating signs the user out for good: the sessions they had don't
    // come back if the account is activated again (`passwordChangedAt` is
    // when sessions were last revoked; see @repo/auth's ./session.ts).
    if (!input.active) set.passwordChangedAt = set.updatedAt;
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

/**
 * An admin sets a new password for another staff user of the tenant, e.g. one
 * forgotten or leaked. Body: { password }, within the policy. Signs that user
 * out everywhere (`replacePassword`). Not for the admin's own: that needs the
 * current password (`changeMyPassword`). The password is only ever stored
 * hashed: it is never returned or logged.
 */
export async function resetUserPassword(ctx: Ctx, userId: string, input: Record<string, unknown>) {
  requireAdmin(ctx);
  if (userId === ctx.userId) throw invalid("cannot_reset_own_password");

  const updated = await replacePassword(
    and(eq(users.id, userId), eq(users.tenantId, ctx.tenantId), isStaffUser),
    newPassword(input.password),
  );
  if (updated.length === 0) throw notFound();
  return { id: userId };
}

/** The caller's own row: they must still be active staff of their tenant. */
const self = (ctx: Ctx) =>
  and(eq(users.id, ctx.userId), eq(users.tenantId, ctx.tenantId), eq(users.active, true), isStaffUser);

const ME = { id: users.id, name: users.name, email: users.email, role: users.role, language: users.language };

/** The caller themselves, with their settings. */
export async function getMe(ctx: Ctx) {
  const [me] = await db.select(ME).from(users).where(self(ctx));
  if (!me) throw notFound();
  return me;
}

/**
 * Body: { language? } — the caller's own settings, each optional: the
 * portal's language ("es" | "en", null to follow the browser again).
 */
export async function updateMe(ctx: Ctx, input: Record<string, unknown>) {
  const set: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
  if (input.language !== undefined) {
    if (input.language !== null && !isAppLanguage(input.language)) throw invalid("invalid_language");
    set.language = input.language;
  }
  const [me] = await db
    .update(users)
    .set(set)
    .where(self(ctx))
    .returning(ME);
  if (!me) throw notFound();
  return me;
}

/**
 * The caller changes their own password. Body: { currentPassword, newPassword }:
 * the current one must be right (`wrong_password`; `too_many_attempts` after
 * ten wrong ones), the new one within the policy (`weak_password`) and another
 * one (`same_password`). Signs the caller out everywhere, this session
 * included: the portal signs it in again (see `changePasswordAction`).
 */
export async function changeMyPassword(ctx: Ctx, input: Record<string, unknown>) {
  await changeOwnPassword(self(ctx), ctx.userId, input, { refuseSame: true });
  return { success: true };
}
