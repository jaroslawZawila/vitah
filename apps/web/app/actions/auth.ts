"use server";

import { signIn } from "../../auth";
import { AuthError, TooManyAttempts } from "@repo/auth";

export async function loginAction(
  _prevState: { error: string } | null,
  formData: FormData
) {
  try {
    await signIn("credentials", {
      email: formData.get("email") as string,
      password: formData.get("password") as string,
      redirectTo: "/dashboard",
    });
    return null;
  } catch (error) {
    if (error instanceof TooManyAttempts) {
      return { error: "too_many_attempts" };
    }
    if (error instanceof AuthError) {
      return { error: "invalid_credentials" };
    }
    throw error;
  }
}
