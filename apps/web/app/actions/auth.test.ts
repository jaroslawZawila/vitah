import { beforeEach, describe, expect, it, vi } from "vitest";
import { loginAction, signOutAction } from "./auth";

// NextAuth's own sign-in needs a request: the action only calls it and reads what it threw.
vi.mock("@repo/auth", () => {
  class AuthError extends Error {}
  class CredentialsSignin extends AuthError {}
  return {
    AuthError,
    TooManyAttempts: class extends CredentialsSignin {},
    MfaRequired: class extends CredentialsSignin {},
    InvalidMfaCode: class extends CredentialsSignin {},
    CredentialsSignin,
  };
});
vi.mock("../../auth", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
const auth = (await import("@repo/auth")) as unknown as Record<
  "AuthError" | "TooManyAttempts" | "MfaRequired" | "InvalidMfaCode" | "CredentialsSignin",
  new () => Error
>;
const { signIn, signOut } = await import("../../auth");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  vi.mocked(signIn).mockReset();
  vi.mocked(signOut).mockReset();
});

describe("loginAction", () => {
  it("signs in with the email and the password, on to the dashboard", async () => {
    expect(await loginAction(null, form({ email: "laura@vitah.es", password: "CasaNordica26" }))).toBeNull();

    expect(signIn).toHaveBeenCalledExactlyOnceWith("credentials", {
      email: "laura@vitah.es",
      password: "CasaNordica26",
      redirectTo: "/dashboard",
    });
  });

  it("sends the two-step verification code along when the form has one", async () => {
    await loginAction(null, form({ email: "laura@vitah.es", password: "CasaNordica26", code: "123 456" }));

    expect(signIn).toHaveBeenCalledExactlyOnceWith("credentials", {
      email: "laura@vitah.es",
      password: "CasaNordica26",
      code: "123 456",
      redirectTo: "/dashboard",
    });
  });

  it("sends no code for an empty one", async () => {
    await loginAction(null, form({ email: "laura@vitah.es", password: "CasaNordica26", code: "  " }));

    expect(vi.mocked(signIn).mock.calls[0]![1]).not.toHaveProperty("code");
  });

  it.each([
    ["MfaRequired", "mfa_required"],
    ["InvalidMfaCode", "invalid_code"],
    ["TooManyAttempts", "too_many_attempts"],
    ["CredentialsSignin", "invalid_credentials"],
    ["AuthError", "invalid_credentials"],
  ] as const)("answers %s as { error: %s }", async (thrown, error) => {
    vi.mocked(signIn).mockRejectedValue(new auth[thrown]());

    expect(await loginAction(null, form({ email: "laura@vitah.es", password: "x", code: "123456" }))).toEqual({
      error,
    });
  });

  it("lets anything else through: the redirect of a sign-in that worked, or a real failure", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;push;/dashboard;307;" });
    vi.mocked(signIn).mockRejectedValue(redirect);

    await expect(loginAction(null, form({ email: "laura@vitah.es", password: "x" }))).rejects.toBe(redirect);
  });
});

describe("signOutAction", () => {
  it("signs this browser out through NextAuth, back to the login page", async () => {
    await signOutAction();

    expect(signOut).toHaveBeenCalledExactlyOnceWith({ redirectTo: "/" });
    expect(signIn).not.toHaveBeenCalled();
  });

  it("lets NextAuth's redirect to the login page through", async () => {
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/;307;" });
    vi.mocked(signOut).mockRejectedValue(redirect);

    await expect(signOutAction()).rejects.toBe(redirect);
  });
});
