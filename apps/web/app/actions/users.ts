"use server";

import { auth } from "../../auth";
import { db, users, eq, and, isStaffUser, STAFF_ROLES, type StaffRole } from "@repo/db";
import { hashPassword, MIN_PASSWORD_LENGTH } from "@repo/core";
import { revalidatePath } from "next/cache";
import { requireAdmin } from "../../lib/session";

// Only staff are managed here. Clients (mobile app users) are managed from
// their project.

export async function getUsers() {
  const session = await auth();
  const user = session?.user;
  if (!user?.tenantId || user.role !== "admin") {
    return [];
  }

  try {
    const staff = await db.query.users.findMany({
      where: and(eq(users.tenantId, user.tenantId), isStaffUser),
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
    return staff.filter((u): u is typeof u & { role: StaffRole } => u.role !== "client");
  } catch {
    return [];
  }
}

export async function createUser(
  _prevState: { error?: string; success?: boolean } | null,
  formData: FormData,
) {
  const { tenantId } = await requireAdmin();

  const email = formData.get("email") as string;
  const name = formData.get("name") as string;
  const password = formData.get("password") as string;
  const role = formData.get("role") as StaffRole;

  if (!email || !name || !password || !STAFF_ROLES.includes(role)) {
    return { error: "missing_fields" };
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    return { error: "password_too_short" };
  }

  const existing = await db.query.users.findFirst({
    where: and(eq(users.tenantId, tenantId), eq(users.email, email)),
  });

  if (existing) {
    return { error: "email_exists" };
  }

  const passwordHash = await hashPassword(password);

  await db.insert(users).values({
    tenantId,
    email,
    name,
    passwordHash,
    role,
  });

  revalidatePath("/dashboard/users");
  return { success: true };
}

export async function updateUserRole(userId: string, role: StaffRole) {
  const { tenantId } = await requireAdmin();
  if (!STAFF_ROLES.includes(role)) throw new Error("Invalid role");

  await db
    .update(users)
    .set({ role, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), isStaffUser));

  revalidatePath("/dashboard/users");
}

export async function toggleUserActive(userId: string, active: boolean) {
  const { tenantId } = await requireAdmin();

  await db
    .update(users)
    .set({ active, updatedAt: new Date() })
    .where(and(eq(users.id, userId), eq(users.tenantId, tenantId), isStaffUser));

  revalidatePath("/dashboard/users");
}
