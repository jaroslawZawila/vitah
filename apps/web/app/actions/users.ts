"use server";

// Thin portal adapters over @repo/core (packages/core/src/users.ts).

import {
  CoreError,
  mfaService,
  usersService as svc,
  type AppLanguage,
  type Ctx,
  type PasswordError,
  type UserRole,
} from "@repo/core";
import { AuthError } from "@repo/auth";
import { revalidatePath } from "next/cache";
import { signIn, signOut } from "../../auth";
import { requireSession } from "../../lib/access";
import { logError } from "../../lib/log";
import { read } from "./run";

/** The portal's staff users (admins only: anyone else gets the "No tienes permiso" page). */
export async function getUsers() {
  return (await read((ctx) => svc.listUsers(ctx)))?.data ?? [];
}

export async function createUser(
  _prevState: { error?: string; success?: boolean } | null,
  formData: FormData,
) {
  const ctx = await requireSession();
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
    await fn(await requireSession());
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

/** A staff user's contact phone (`phone` in the form; blank clears it): what a client sees of their site manager. */
export async function updateUserPhoneAction(userId: string, formData: FormData) {
  return mutate((ctx) => svc.updateUser(ctx, userId, { phone: formData.get("phone") }));
}

/**
 * An admin sets another staff user's password (`password` in the form, so it
 * stays out of the action's logged arguments); that user is signed out everywhere.
 */
export async function resetUserPasswordAction(userId: string, formData: FormData) {
  return mutate((ctx) => svc.resetUserPassword(ctx, userId, { password: formData.get("password") }));
}

/**
 * An admin removes another staff user's two-step verification (their phone is
 * lost): they sign in with the password alone, and their sessions end.
 */
export async function removeUserMfaAction(userId: string) {
  return mutate((ctx) => mfaService.removeUserMfa(ctx, userId));
}

export type PasswordChangeState = {
  error?: PasswordError;
  success?: boolean;
  /** This browser could not be kept signed in: sign in with the new password. */
  signedOut?: boolean;
};

/**
 * The caller changes their own password (any staff role). The form carries
 * `currentPassword` and `newPassword` (a form, so they stay out of the
 * action's logged arguments). The change revokes every session of the user,
 * this one included, so this browser is signed in again with the new password:
 * the others are out within a minute, this one carries on. Should that fail
 * (e.g. the IP is throttled), it is signed out too and told so. That is also
 * what happens to a user with two-step verification: the password alone does
 * not sign them in (`MfaRequired`), so they sign in again, with their code.
 */
export async function changePasswordAction(formData: FormData): Promise<PasswordChangeState> {
  const ctx = await requireSession();
  const newPassword = formData.get("newPassword");
  try {
    await svc.changeMyPassword(ctx, { currentPassword: formData.get("currentPassword"), newPassword });
  } catch (err) {
    if (err instanceof CoreError) return { error: err.code as PasswordError };
    throw err;
  }
  try {
    const { email } = await svc.getMe(ctx);
    await signIn("credentials", { email, password: newPassword, redirect: false });
    return { success: true };
  } catch (err) {
    // The password did change: don't fail the form, end this session cleanly.
    // An unexpected failure is logged by what it was only: the error itself may carry the email.
    if (!(err instanceof AuthError || err instanceof CoreError)) {
      logError("users.password_resignin_failed", undefined, {
        userId: ctx.userId,
        errorName: err instanceof Error ? err.name : "NonError",
      });
    }
    await signOut({ redirect: false });
    return { success: true, signedOut: true };
  }
}

/** The caller's own portal language (any staff role); the whole portal re-renders in it. */
export async function setLanguageAction(language: AppLanguage): Promise<{ error?: string }> {
  const ctx = await requireSession();
  try {
    await svc.updateMe(ctx, { language });
  } catch (err) {
    if (err instanceof CoreError) return { error: err.code };
    throw err;
  }
  // i18n/request.ts reads it on every render.
  revalidatePath("/", "layout");
  return {};
}
