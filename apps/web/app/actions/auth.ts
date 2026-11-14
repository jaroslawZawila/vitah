"use server";

import { signIn, signOut } from "../../auth";
import { AuthError, InvalidMfaCode, MfaRequired, TooManyAttempts } from "@repo/auth";

/**
 * What a sign-in was refused for. `mfa_required` is not a failure: the
 * password was right and the account has two-step verification, so the form
 * asks for the code and sends all three again. It is only ever answered for a
 * right password; anything else about the email or the password is
 * `invalid_credentials`, with or without a code.
 */
export type LoginError = "invalid_credentials" | "too_many_attempts" | "mfa_required" | "invalid_code";

/** The form's `email` and `password`, and `code` on the second step. */
export async function loginAction(
  _prevState: { error: LoginError } | null,
  formData: FormData
): Promise<{ error: LoginError } | null> {
  const code = formData.get("code");
  try {
    await signIn("credentials", {
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      ...(typeof code === "string" && code.trim() ? { code } : {}),
      redirectTo: "/dashboard",
    });
    return null;
  } catch (error) {
    if (error instanceof TooManyAttempts) {
      return { error: "too_many_attempts" };
    }
    if (error instanceof MfaRequired) {
      return { error: "mfa_required" };
    }
    if (error instanceof InvalidMfaCode) {
      return { error: "invalid_code" };
    }
    if (error instanceof AuthError) {
      return { error: "invalid_credentials" };
    }
    throw error;
  }
}

/**
 * Signs this browser out and returns to the login page. Only this browser:
 * the user's other sessions carry on (a password change ends them all).
 */
export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/" });
}
