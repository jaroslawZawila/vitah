import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { mfaService } from "@repo/core";
import { base32Decode, totp } from "@repo/core/totp";

// NextAuth itself does not load outside Next: stand-ins that hand the
// configuration back, so the provider's `authorize` and the callbacks (ours)
// are run as NextAuth would run them.
vi.mock("next-auth", () => {
  class AuthError extends Error {}
  class CredentialsSignin extends AuthError {
    code = "credentials";
  }
  return {
    default: (config: unknown) => ({ handlers: config, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() }),
    AuthError,
    CredentialsSignin,
  };
});
vi.mock("next-auth/providers/credentials", () => ({ default: (options: unknown) => options }));

type Authorize = (credentials: Record<string, unknown>, request: Request) => Promise<Record<string, unknown> | null>;
type Callbacks = {
  jwt: (params: { token: Record<string, unknown>; user?: Record<string, unknown> }) => Promise<Record<string, unknown> | null>;
  session: (params: { session: { user: Record<string, unknown> }; token: Record<string, unknown> }) => Promise<{
    user: Record<string, unknown>;
  }>;
};

const authModule = await import("../src/index");
const { AuthError, InvalidMfaCode, MfaRequired, TooManyAttempts } = authModule;
const config = authModule.handlers as unknown as {
  providers: [{ authorize: Authorize }];
  callbacks: Callbacks;
  logger: { error: (error: Error) => void };
};
const authorize = (credentials: Record<string, unknown>) =>
  config.providers[0].authorize(credentials, new Request("http://localhost/", { headers: { "x-real-ip": "1.2.3.4" } }));

const EMAIL = "laura@example.com";
const PASSWORD = "CasaNordica26";

async function enrolledUser() {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { email: EMAIL, role: "admin", password: PASSWORD });
  const ctx = { tenantId: tenant.id, userId: user.id, role: "admin" as const };
  const { secret } = await mfaService.beginEnrolment(ctx);
  const then = new Date(Date.now() - 300_000);
  const { recoveryCodes } = await mfaService.confirmEnrolment(ctx, { code: totp(base32Decode(secret)!, then.getTime()) }, then);
  return { user, secret, recoveryCodes };
}

beforeEach(async () => {
  await resetDatabase();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("the Credentials provider's authorize", () => {
  it("signs a user without two-step verification in with the password, as before", async () => {
    const tenant = await createTestTenant();
    const user = await createTestUser(tenant.id, { email: EMAIL, role: "viewer", password: PASSWORD });

    expect(await authorize({ email: EMAIL, password: PASSWORD })).toMatchObject({ id: user.id, role: "viewer", mfa: false });
    expect(await authorize({ email: EMAIL, password: "NotThisOne26" })).toBeNull();
    expect(await authorize({ email: EMAIL })).toBeNull();
  });

  it("throws MfaRequired for the right password without a code, and only then", async () => {
    await enrolledUser();

    await expect(authorize({ email: EMAIL, password: PASSWORD })).rejects.toBeInstanceOf(MfaRequired);
    await expect(authorize({ email: EMAIL, password: PASSWORD })).rejects.toMatchObject({ code: "mfa_required" });
    // A wrong password is the plain refusal, code or no code: nothing says the account has it.
    expect(await authorize({ email: EMAIL, password: "NotThisOne26" })).toBeNull();
    expect(await authorize({ email: EMAIL, password: "NotThisOne26", code: "123456" })).toBeNull();
  });

  it("signs in with the code, and throws InvalidMfaCode for a wrong one", async () => {
    const { user, secret } = await enrolledUser();

    await expect(authorize({ email: EMAIL, password: PASSWORD, code: "000000" })).rejects.toBeInstanceOf(InvalidMfaCode);
    await expect(authorize({ email: EMAIL, password: PASSWORD, code: "000000" })).rejects.toMatchObject({
      code: "invalid_code",
    });
    expect(
      await authorize({ email: EMAIL, password: PASSWORD, code: totp(base32Decode(secret)!, Date.now()) }),
    ).toMatchObject({ id: user.id, mfa: true });
  });

  it("throws TooManyAttempts once wrong codes used the IP's allowance up", async () => {
    const { recoveryCodes } = await enrolledUser();
    for (let i = 0; i < 10; i++) {
      await expect(authorize({ email: EMAIL, password: PASSWORD, code: "AAAAA-AAAAA" })).rejects.toBeInstanceOf(
        InvalidMfaCode,
      );
    }

    await expect(authorize({ email: EMAIL, password: PASSWORD, code: recoveryCodes[0] })).rejects.toBeInstanceOf(
      TooManyAttempts,
    );
  });

  it("refuses with errors the login action tells apart, all of them sign-in errors", () => {
    for (const refusal of [new MfaRequired(), new InvalidMfaCode(), new TooManyAttempts()]) {
      expect(refusal).toBeInstanceOf(AuthError);
    }
    expect(new MfaRequired()).not.toBeInstanceOf(InvalidMfaCode);
    expect(new InvalidMfaCode()).not.toBeInstanceOf(TooManyAttempts);
  });
});

describe("the session's mfa claim", () => {
  it("is set at sign-in from what authorize answered, and shown on the session", async () => {
    const { user, secret } = await enrolledUser();
    const signedIn = await authorize({ email: EMAIL, password: PASSWORD, code: totp(base32Decode(secret)!, Date.now()) });

    const token = (await config.callbacks.jwt({ token: { sub: user.id }, user: signedIn! }))!;
    const session = await config.callbacks.session({ session: { user: {} }, token });

    expect(token).toMatchObject({ sub: user.id, role: "admin", mfa: true });
    expect(session.user).toMatchObject({ id: user.id, role: "admin", tenantId: user.tenantId, mfa: true });
  });

  it("is false on the session of a password-only sign-in", async () => {
    const tenant = await createTestTenant();
    const user = await createTestUser(tenant.id, { email: EMAIL, role: "viewer", password: PASSWORD });
    const signedIn = await authorize({ email: EMAIL, password: PASSWORD });

    const token = (await config.callbacks.jwt({ token: { sub: user.id }, user: signedIn! }))!;
    const session = await config.callbacks.session({ session: { user: {} }, token });

    expect(token).not.toHaveProperty("mfa");
    expect(session.user).toMatchObject({ id: user.id, mfa: false });
  });
});

describe("what Auth.js logs", () => {
  const lines = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map((call) => JSON.parse(call[0] as string));

  it("is nothing for being asked for the code: a step of signing in, not an error", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    config.logger.error(new MfaRequired());

    expect(error).not.toHaveBeenCalled();
  });

  it("is one line of the portal's log for a refusal, and for a real failure what failed", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    config.logger.error(new InvalidMfaCode());
    config.logger.error(new TooManyAttempts());
    // What Auth.js makes of an error thrown inside `authorize`.
    const wrapped = Object.assign(new AuthError("callback failed"), { type: "CallbackRouteError" });
    wrapped.cause = { err: new TypeError("database down for laura@example.com"), provider: "credentials" };
    config.logger.error(wrapped);

    expect(lines(error)).toEqual([
      expect.objectContaining({ level: "error", event: "auth.error", error: expect.objectContaining({ name: "Error" }) }),
      expect.objectContaining({ level: "error", event: "auth.error" }),
      expect.objectContaining({
        level: "error",
        event: "auth.error",
        type: "CallbackRouteError",
        error: expect.objectContaining({ name: "TypeError", message: "database down for [email]" }),
      }),
    ]);
  });
});
