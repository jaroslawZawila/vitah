"use server";

// Thin portal adapters over @repo/core (packages/core/src/mfa.ts): the signed-in
// user's own two-step verification. Codes and the password travel in a form,
// so they stay out of the actions' logged arguments.

import { CoreError, mfaService as svc, type Ctx, type MfaEnrolment, type MfaError, type MfaStatus } from "@repo/core";
import { revalidatePath } from "next/cache";
import { requireSession } from "../../lib/access";

/**
 * Whether the caller has two-step verification on (the rail's settings read
 * it). Null while it is not available (`mfa_unavailable`: its table is not in
 * the database yet, which core has logged): the settings then don't offer it.
 */
export async function getMfaStatus(): Promise<MfaStatus | null> {
  const ctx = await requireSession();
  try {
    return await svc.getStatus(ctx);
  } catch (err) {
    if (err instanceof CoreError && err.code === "mfa_unavailable") return null;
    throw err;
  }
}

/** Runs a core call for the caller; `{ error: code }` for an expected failure. The rail shows the new state. */
async function run<T extends object>(fn: (ctx: Ctx) => Promise<T>, { changes = true } = {}): Promise<T | { error: MfaError }> {
  const ctx = await requireSession();
  let result: T;
  try {
    result = await fn(ctx);
  } catch (err) {
    if (err instanceof CoreError) return { error: err.code as MfaError };
    throw err;
  }
  if (changes) revalidatePath("/dashboard", "layout");
  return result;
}

export type MfaBeginState = { error?: MfaError; enrolment?: MfaEnrolment };
export type MfaCodesState = { error?: MfaError; recoveryCodes?: string[] };
export type MfaDisableState = { error?: MfaError; success?: boolean };

/** Starts enrolling: the secret to add to an authenticator app, shown this once. */
export async function beginMfaAction(): Promise<MfaBeginState> {
  return run(async (ctx) => ({ enrolment: await svc.beginEnrolment(ctx) }), { changes: false });
}

/** The form's `code` confirms the enrolment: it is on, and the recovery codes come back this once. */
export async function confirmMfaAction(formData: FormData): Promise<MfaCodesState> {
  return run((ctx) => svc.confirmEnrolment(ctx, { code: formData.get("code") }));
}

/** Turns it off: the form carries `password` and `code`. */
export async function disableMfaAction(formData: FormData): Promise<MfaDisableState> {
  return run((ctx) => svc.disable(ctx, { password: formData.get("password"), code: formData.get("code") }));
}

/** New recovery codes for the form's `code`; the old ones stop working. */
export async function regenerateRecoveryCodesAction(formData: FormData): Promise<MfaCodesState> {
  return run((ctx) => svc.regenerateRecoveryCodes(ctx, { code: formData.get("code") }));
}
