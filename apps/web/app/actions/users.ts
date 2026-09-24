"use server";

// Thin portal adapters over @repo/core (packages/core/src/users.ts).

import {
  CoreError,
  usersService as svc,
  type Ctx,
  type UserRole,
} from "@repo/core";
import { getSessionContext } from "@repo/auth/context";
import { revalidatePath } from "next/cache";

async function requireAuth(): Promise<Ctx> {
  const ctx = await getSessionContext();
  if (!ctx) throw new Error("Unauthorized");
  return ctx;
}

export async function getUsers() {
  const ctx = await getSessionContext();
  if (!ctx || ctx.role !== "admin") return [];
  try {
    return await svc.listUsers(ctx);
  } catch {
    return [];
  }
}

export async function createUser(
  _prevState: { error?: string; success?: boolean } | null,
  formData: FormData,
) {
  const ctx = await requireAuth();
  try {
    await svc.createUser(ctx, Object.fromEntries(formData));
  } catch (err) {
    if (err instanceof CoreError) return { error: err.code };
    throw err;
  }
  revalidatePath("/dashboard/users");
  return { success: true };
}

/** Runs a core mutation; returns `{ error: code }` for expected failures. */
async function mutate(fn: (ctx: Ctx) => Promise<unknown>) {
  try {
    await fn(await requireAuth());
  } catch (err) {
    if (err instanceof CoreError) return { error: err.code };
    throw err;
  }
  revalidatePath("/dashboard/users");
  return {};
}

export async function updateUserRole(userId: string, role: UserRole) {
  return mutate((ctx) => svc.updateUser(ctx, userId, { role }));
}

export async function toggleUserActive(userId: string, active: boolean) {
  return mutate((ctx) => svc.updateUser(ctx, userId, { active }));
}
