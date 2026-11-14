import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, loginAttempts, userMfa, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { mfaService, type Ctx } from "@repo/core";
import { base32Decode, totp } from "@repo/core/totp";
import { attemptSignIn } from "@repo/auth/credentials";
import { signInAs } from "../../test/session";
import { changePasswordAction, resetUserPasswordAction, toggleUserActive } from "./users";

// Changing the password signs this browser in again with the new one (main);
// an account with two-step verification can't be signed in by a password
// alone (the MFA change). Together: that user's browser is signed out too,
// told so, and signs in again with the new password and their code.

vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// NextAuth itself needs a request. Its errors, as packages/auth has them: all sign-in errors.
vi.mock("@repo/auth", () => {
  class AuthError extends Error {}
  class CredentialsSignin extends AuthError {}
  return {
    AuthError,
    CredentialsSignin,
    TooManyAttempts: class extends CredentialsSignin {},
    MfaRequired: class extends CredentialsSignin {},
    InvalidMfaCode: class extends CredentialsSignin {},
  };
});
vi.mock("../../auth", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
const errors = (await import("@repo/auth")) as unknown as Record<
  "CredentialsSignin" | "TooManyAttempts" | "MfaRequired" | "InvalidMfaCode",
  new () => Error
>;
const { signIn, signOut } = await import("../../auth");

const CURRENT = "old-pass";
const NEXT = "CasaNordica26";
const EMAIL = "vera@example.com";

/**
 * NextAuth's `signIn("credentials", …)` as the provider's `authorize` answers
 * it (packages/auth/src/index.ts): the real check of the email, the password
 * and the code, and the error it throws for each refusal.
 */
async function credentialsSignIn(_provider: string, options: { email: string; password: string; code?: string }) {
  const user = await attemptSignIn(options.email, options.password, "portal", undefined, options.code);
  if (user === "too_many_attempts") throw new errors.TooManyAttempts();
  if (user === "mfa_required") throw new errors.MfaRequired();
  if (user === "invalid_code") throw new errors.InvalidMfaCode();
  if (!user) throw new errors.CredentialsSignin();
  return user;
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** The app's code now. */
const appCode = (secret: string) => totp(base32Decode(secret)!, Date.now());

async function staff(role: "admin" | "viewer", tenantId: string, email: string) {
  const user = await createTestUser(tenantId, { role, password: CURRENT, email });
  const ctx: Ctx = { tenantId, userId: user.id, role };
  return { user, ctx };
}

/** A viewer with two-step verification on (confirmed five minutes ago), and an admin of their tenant. */
async function enrolled() {
  const tenant = await createTestTenant();
  const vera = await staff("viewer", tenant.id, EMAIL);
  const admin = await staff("admin", tenant.id, "admin@example.com");
  const { secret } = await mfaService.beginEnrolment(vera.ctx);
  const then = new Date(Date.now() - 300_000);
  await mfaService.confirmEnrolment(vera.ctx, { code: totp(base32Decode(secret)!, then.getTime()) }, then);
  return { ...vera, admin, secret };
}

const reload = async (id: string) => (await db.query.users.findFirst({ where: eq(users.id, id) }))!;
const hasPassword = async (id: string, password: string) => bcrypt.compare(password, (await reload(id)).passwordHash!);
const mfaOn = async (id: string) => (await db.query.userMfa.findFirst({ where: eq(userMfa.userId, id) }))?.confirmedAt instanceof Date;

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(signIn).mockReset().mockImplementation(credentialsSignIn as never);
  vi.mocked(signOut).mockReset();
});

describe("changePasswordAction, with two-step verification on", () => {
  it("changes the password and signs this browser out too, saying so: the password alone signs nobody in", async () => {
    const { user, ctx, secret } = await enrolled();
    signInAs(ctx);
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(await changePasswordAction(form({ currentPassword: CURRENT, newPassword: NEXT }))).toEqual({
      success: true,
      signedOut: true,
    });

    expect(await hasPassword(user.id, NEXT)).toBe(true);
    // Every session from before is revoked, this browser's among them, and no new one was made.
    expect((await reload(user.id)).passwordChangedAt).toBeInstanceOf(Date);
    expect(signIn).toHaveBeenCalledExactlyOnceWith("credentials", { email: EMAIL, password: NEXT, redirect: false });
    await expect(vi.mocked(signIn).mock.results[0]!.value).rejects.toBeInstanceOf(errors.MfaRequired);
    expect(signOut).toHaveBeenCalledExactlyOnceWith({ redirect: false });
    // Being asked for the code is a step of signing in: not an error line, not a failed attempt.
    expect(logged).not.toHaveBeenCalled();
    expect(await db.select().from(loginAttempts)).toSatisfy((rows: { failures: number }[]) => rows.every((row) => row.failures === 0));
    logged.mockRestore();

    // Two-step verification is as it was: the new password and the code sign in, the old password never.
    expect(await mfaOn(user.id)).toBe(true);
    expect(await attemptSignIn(EMAIL, NEXT, "portal", undefined)).toBe("mfa_required");
    expect(await attemptSignIn(EMAIL, CURRENT, "portal", undefined, appCode(secret))).toBeNull();
    expect(await attemptSignIn(EMAIL, NEXT, "portal", undefined, appCode(secret))).toMatchObject({ id: user.id, mfa: true });
  });

  it("keeps a user without it signed in, as before: the same check, the other answer", async () => {
    const tenant = await createTestTenant();
    const { user, ctx } = await staff("viewer", tenant.id, EMAIL);
    signInAs(ctx);

    expect(await changePasswordAction(form({ currentPassword: CURRENT, newPassword: NEXT }))).toEqual({ success: true });

    await expect(vi.mocked(signIn).mock.results[0]!.value).resolves.toMatchObject({ id: user.id, mfa: false });
    expect(signOut).not.toHaveBeenCalled();
  });

  it("leaves the password, the session and the second step alone when the current password is wrong", async () => {
    const { user, ctx } = await enrolled();
    signInAs(ctx);

    expect(await changePasswordAction(form({ currentPassword: "not-this-one", newPassword: NEXT }))).toEqual({
      error: "wrong_password",
    });

    expect(await hasPassword(user.id, CURRENT)).toBe(true);
    expect((await reload(user.id)).passwordChangedAt).toBeNull();
    expect(signIn).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
    expect(await mfaOn(user.id)).toBe(true);
  });
});

describe("an admin's reset and deactivation, for a user with two-step verification", () => {
  it("resets the password without taking the second step away: the new password still needs the code", async () => {
    const { user, admin, secret } = await enrolled();
    signInAs(admin.ctx);

    expect(await resetUserPasswordAction(user.id, form({ password: NEXT }))).toEqual({});

    expect((await reload(user.id)).passwordChangedAt).toBeInstanceOf(Date);
    expect(await mfaOn(user.id)).toBe(true);
    expect(await attemptSignIn(EMAIL, NEXT, "portal", undefined)).toBe("mfa_required");
    expect(await attemptSignIn(EMAIL, NEXT, "portal", undefined, appCode(secret))).toMatchObject({ id: user.id, mfa: true });
    // The admin's own session is not this action's to touch.
    expect(signIn).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });

  it("deactivates them whatever their code, and activated again they sign in with both steps as before", async () => {
    const { user, admin, secret } = await enrolled();
    signInAs(admin.ctx);

    expect(await toggleUserActive(user.id, false)).toEqual({});
    // Nothing is given away: the right password and code answer as a wrong password does.
    expect(await attemptSignIn(EMAIL, CURRENT, "portal", undefined, appCode(secret))).toBeNull();
    expect(await attemptSignIn(EMAIL, CURRENT, "portal", undefined)).toBeNull();
    expect(await mfaOn(user.id)).toBe(true);

    expect(await toggleUserActive(user.id, true)).toEqual({});
    expect(await attemptSignIn(EMAIL, CURRENT, "portal", undefined)).toBe("mfa_required");
    expect(await attemptSignIn(EMAIL, CURRENT, "portal", undefined, appCode(secret))).toMatchObject({ id: user.id, mfa: true });
  });
});
