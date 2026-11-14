import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, loginAttempts, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { mfaService, SIGN_IN_LIMITS, usersService, type Ctx } from "@repo/core";
import { base32Decode, totp, TOTP_STEP_SECONDS } from "@repo/core/totp";
import { attemptSignIn, PASSWORD_CHANGE_GRACE_MS } from "../src/credentials";
import { createMobileToken } from "../src/mobile";
import { refreshSessionToken, signedInToken } from "../src/session";

// context.ts reads the portal session through NextAuth's `auth()`.
vi.mock("../src/index", () => ({ auth: vi.fn() }));
const { getRequestContext } = await import("../src/context");

const EMAIL = "laura@example.com";
const PASSWORD = "CasaNordica26";
const IP = "1.2.3.4";

/** What the authenticator shows `steps` half-minutes from now. */
const appCode = (secret: string, steps = 0) =>
  totp(base32Decode(secret)!, Date.now() + steps * TOTP_STEP_SECONDS * 1000);
/** Six digits no accepted step has right now. */
function wrongCode(secret: string) {
  const taken = [-1, 0, 1].map((steps) => appCode(secret, steps));
  return ["000000", "111111", "222222", "333333"].find((code) => !taken.includes(code))!;
}

async function staff(email = EMAIL, role: "admin" | "manager" | "viewer" = "manager", tenantId?: string) {
  const tenant = tenantId ?? (await createTestTenant()).id;
  const user = await createTestUser(tenant, { email, role, password: PASSWORD });
  const ctx: Ctx = { tenantId: tenant, userId: user.id, role };
  return { user, ctx };
}

/** A staff user with two-step verification on, confirmed five minutes ago. */
async function enrolled(email = EMAIL, role: "admin" | "manager" | "viewer" = "manager", tenantId?: string) {
  const account = await staff(email, role, tenantId);
  const { secret } = await mfaService.beginEnrolment(account.ctx);
  const then = new Date(Date.now() - 10 * TOTP_STEP_SECONDS * 1000);
  const { recoveryCodes } = await mfaService.confirmEnrolment(
    account.ctx,
    { code: totp(base32Decode(secret)!, then.getTime()) },
    then,
  );
  return { ...account, secret, recoveryCodes };
}

const signIn = (password: string, code?: string, email = EMAIL, ip = IP) =>
  attemptSignIn(email, password, "portal", ip, code);

const failuresCounted = async () =>
  Object.fromEntries((await db.select().from(loginAttempts)).map((row) => [row.key.split(":")[0], row.failures]));

beforeEach(async () => {
  await resetDatabase();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("signing in to the portal: two-step verification off", () => {
  it("is the password alone, as before, and says the second step was not passed", async () => {
    const { user } = await staff();

    expect(await signIn(PASSWORD)).toEqual({
      id: user.id,
      email: EMAIL,
      name: user.name,
      role: "manager",
      tenantId: user.tenantId,
      mfa: false,
    });
  });

  it("ignores a code sent along", async () => {
    const { user } = await staff();

    expect(await signIn(PASSWORD, "123456")).toMatchObject({ id: user.id, mfa: false });
  });

  it("is still the password alone while an enrolment is not confirmed", async () => {
    const { user, ctx } = await staff();
    await mfaService.beginEnrolment(ctx);

    expect(await signIn(PASSWORD)).toMatchObject({ id: user.id, mfa: false });
  });
});

describe("signing in to the portal: two-step verification on", () => {
  it("asks for the code once the password is right", async () => {
    await enrolled();

    expect(await signIn(PASSWORD)).toBe("mfa_required");
    expect(await signIn(PASSWORD, "")).toBe("mfa_required");
    expect(await signIn(PASSWORD, "  ")).toBe("mfa_required");
  });

  it("signs in with the password and the app's code, and notes the second step", async () => {
    const { user, secret } = await enrolled();

    expect(await signIn(PASSWORD, appCode(secret))).toEqual({
      id: user.id,
      email: EMAIL,
      name: user.name,
      role: "manager",
      tenantId: user.tenantId,
      mfa: true,
    });
  });

  it("answers a wrong code with invalid_code", async () => {
    const { secret } = await enrolled();

    expect(await signIn(PASSWORD, wrongCode(secret))).toBe("invalid_code");
    expect(await signIn(PASSWORD, "not a code")).toBe("invalid_code");
  });

  it("refuses a code used already, in the same half minute or after", async () => {
    const { secret } = await enrolled();
    const code = appCode(secret);

    expect(await signIn(PASSWORD, code)).toMatchObject({ mfa: true });
    expect(await signIn(PASSWORD, code)).toBe("invalid_code");
    // The next one is a new code.
    expect(await signIn(PASSWORD, appCode(secret, 1))).toMatchObject({ mfa: true });
  });

  it("takes a recovery code once", async () => {
    const { user, ctx, recoveryCodes } = await enrolled();

    expect(await signIn(PASSWORD, recoveryCodes[0])).toMatchObject({ id: user.id, mfa: true });
    expect(await signIn(PASSWORD, recoveryCodes[0])).toBe("invalid_code");
    expect(await mfaService.getStatus(ctx)).toEqual({ enabled: true, recoveryCodesLeft: 9 });
    expect(await signIn(PASSWORD, recoveryCodes[1])).toMatchObject({ mfa: true });
  });
});

describe("what a sign-in gives away without the password", () => {
  it("nothing: a wrong password answers the same with it on, off, or no such account", async () => {
    const tenant = await createTestTenant();
    const on = await enrolled("on@example.com", "admin", tenant.id);
    await staff("off@example.com", "admin", tenant.id);

    for (const email of ["on@example.com", "off@example.com", "nobody@example.com"]) {
      // No code, a code that would be right, a wrong one, a recovery code: all the same answer.
      for (const code of [undefined, appCode(on.secret), "000000", on.recoveryCodes[0]]) {
        expect(await signIn("NotThisOne26", code, email)).toBeNull();
      }
    }
    // And nothing was spent: the code and the recovery code still work with the right password.
    expect(await signIn(PASSWORD, on.recoveryCodes[0], "on@example.com")).toMatchObject({ mfa: true });
    expect(await signIn(PASSWORD, appCode(on.secret), "on@example.com")).toMatchObject({ mfa: true });
  });

  it("nor from the counters: wrong passwords are counted alike, and refused at the same attempt", async () => {
    await enrolled("on@example.com");
    await staff("off@example.com");

    for (const email of ["on@example.com", "off@example.com", "nobody@example.com"]) {
      for (let i = 0; i < SIGN_IN_LIMITS.emailFromIp; i++) {
        expect(await signIn("NotThisOne26", "123456", email)).toBeNull();
      }
      expect(await signIn("NotThisOne26", "123456", email)).toBe("too_many_attempts");
      expect(await signIn(PASSWORD, undefined, email)).toBe("too_many_attempts");
    }
  });
});

describe("guessing codes", () => {
  it("is throttled exactly like guessing passwords: ten wrong codes, then refused, right code or not", async () => {
    const { secret } = await enrolled();
    for (let i = 0; i < SIGN_IN_LIMITS.emailFromIp; i++) {
      expect(await signIn(PASSWORD, wrongCode(secret))).toBe("invalid_code");
    }

    expect(await signIn(PASSWORD, appCode(secret))).toBe("too_many_attempts");
    expect(await signIn(PASSWORD)).toBe("too_many_attempts");
    // From elsewhere the owner still gets in.
    expect(await signIn(PASSWORD, appCode(secret), EMAIL, "5.6.7.8")).toMatchObject({ mfa: true });
  });

  it("counts on the same keys as wrong passwords: the two add up", async () => {
    const { secret } = await enrolled();
    for (let i = 0; i < 5; i++) expect(await signIn("NotThisOne26")).toBeNull();
    for (let i = 0; i < 5; i++) expect(await signIn(PASSWORD, wrongCode(secret))).toBe("invalid_code");

    expect(await failuresCounted()).toEqual({ "signin-pair": 10, "signin-ip": 10, "signin-email": 10 });
    expect(await signIn(PASSWORD, appCode(secret))).toBe("too_many_attempts");
  });

  it("does not count being asked for the code, however often", async () => {
    const { secret } = await enrolled();
    for (let i = 0; i < SIGN_IN_LIMITS.emailFromIp + 5; i++) {
      expect(await signIn(PASSWORD)).toBe("mfa_required");
    }

    expect(await failuresCounted()).toEqual({ "signin-pair": 0, "signin-ip": 0, "signin-email": 0 });
    expect(await signIn(PASSWORD, appCode(secret))).toMatchObject({ mfa: true });
  });

  it("can't be reset by asking for the code step again between guesses", async () => {
    const { secret } = await enrolled();
    for (let i = 0; i < SIGN_IN_LIMITS.emailFromIp; i++) {
      expect(await signIn(PASSWORD)).toBe("mfa_required");
      expect(await signIn(PASSWORD, wrongCode(secret))).toBe("invalid_code");
    }

    expect(await signIn(PASSWORD, appCode(secret))).toBe("too_many_attempts");
  });

  it("forgets the IP's wrong codes once a sign-in goes through, as with passwords", async () => {
    const { secret } = await enrolled();
    for (let i = 0; i < SIGN_IN_LIMITS.emailFromIp - 1; i++) await signIn(PASSWORD, wrongCode(secret));
    expect(await signIn(PASSWORD, appCode(secret))).toMatchObject({ mfa: true });
    for (let i = 0; i < SIGN_IN_LIMITS.emailFromIp - 1; i++) await signIn(PASSWORD, wrongCode(secret));

    expect(await signIn(PASSWORD, appCode(secret, 1))).toMatchObject({ mfa: true });
  });

  it("without an IP, shares the email's allowance and takes the code step back off it", async () => {
    const { secret } = await enrolled();

    expect(await attemptSignIn(EMAIL, PASSWORD, "portal", undefined)).toBe("mfa_required");
    expect(await attemptSignIn(EMAIL, PASSWORD, "portal", undefined, wrongCode(secret))).toBe("invalid_code");

    expect(await failuresCounted()).toEqual({ "signin-noip": 1, "signin-email": 1 });
  });
});

describe("the app's clients", () => {
  it("sign in as before: no second step, no new field in what is answered", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, { email: "ana@example.com", role: "client", password: PASSWORD });

    expect(await attemptSignIn("ana@example.com", PASSWORD, "mobile", IP)).toEqual({
      id: client.id,
      email: "ana@example.com",
      name: client.name,
      role: "client",
      tenantId: tenant.id,
    });
  });

  it("a staff member with two-step verification still can't sign in to the app, and learns nothing there", async () => {
    await enrolled();

    expect(await attemptSignIn(EMAIL, PASSWORD, "mobile", IP)).toBeNull();
  });
});

describe("the session of a sign-in", () => {
  it("carries the mfa claim only when the second step was passed", () => {
    const base = { role: "manager" as const, tenantId: "t-1" };

    expect(signedInToken({ sub: "u-1" }, { ...base, mfa: true }, 5000)).toEqual({
      sub: "u-1",
      ...base,
      mfa: true,
      checkedAt: 5000,
      authAt: 5000,
    });
    expect(signedInToken({ sub: "u-1" }, { ...base, mfa: false }, 5000)).not.toHaveProperty("mfa");
    expect(signedInToken({ sub: "u-1" }, base, 5000)).not.toHaveProperty("mfa");
  });

  it("never inherits the claim from the token it starts from", () => {
    const token = signedInToken({ sub: "u-1", mfa: true }, { role: "manager", tenantId: "t-1" }, 5000);

    expect(token).not.toHaveProperty("mfa");
  });

  it("keeps the claim while the session lives", async () => {
    const { user } = await enrolled();
    const token = signedInToken({ sub: user.id }, { role: "manager", tenantId: user.tenantId, mfa: true });

    expect(await refreshSessionToken({ ...token, checkedAt: 0 })).toMatchObject({ sub: user.id, mfa: true });
  });
});

describe("an admin removing a user's two-step verification", () => {
  it("ends that user's portal sessions and tokens, and nobody else's; they then sign in with the password alone", async () => {
    const tenant = await createTestTenant();
    const admin = await enrolled("admin@example.com", "admin", tenant.id);
    const marcos = await enrolled("marcos@example.com", "viewer", tenant.id);
    // Sessions and tokens from two minutes ago.
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() - 120_000 });
    const sessionOf = (who: typeof marcos) =>
      signedInToken({ sub: who.user.id }, { role: who.ctx.role, tenantId: tenant.id, mfa: true });
    const tokenOf = (who: typeof marcos) =>
      createMobileToken({ sub: who.user.id, email: who.user.email, name: null, role: who.ctx.role, tenantId: tenant.id });
    const sessions = { marcos: sessionOf(marcos), admin: sessionOf(admin) };
    const tokens = { marcos: await tokenOf(marcos), admin: await tokenOf(admin) };
    vi.useRealTimers();
    const bearer = (token: string) =>
      getRequestContext(new Request("http://localhost/api/v1/me", { headers: { Authorization: `Bearer ${token}` } }));

    await mfaService.removeUserMfa(admin.ctx, marcos.user.id);

    const afterGrace = Date.now() + PASSWORD_CHANGE_GRACE_MS + 1000;
    expect(await refreshSessionToken({ ...sessions.marcos, checkedAt: 0 }, afterGrace)).toBeNull();
    expect(await refreshSessionToken({ ...sessions.admin, checkedAt: 0 }, afterGrace)).toMatchObject({ mfa: true });
    vi.useFakeTimers({ toFake: ["Date"], now: afterGrace });
    expect(await bearer(tokens.marcos)).toBeNull();
    expect(await bearer(tokens.admin)).toMatchObject({ userId: admin.user.id });
    vi.useRealTimers();

    expect(await signIn(PASSWORD, undefined, "marcos@example.com")).toMatchObject({ id: marcos.user.id, mfa: false });
    expect((await db.query.users.findFirst({ where: eq(users.id, marcos.user.id) }))!.active).toBe(true);
  });
});

describe("what ends the sessions of a user with two-step verification", () => {
  const NEXT = "OtraCasa2026";
  const afterGrace = () => Date.now() + PASSWORD_CHANGE_GRACE_MS + 1000;
  /** A session that passed both steps a minute ago, due for its re-check. */
  const sessionOf = (who: { user: { id: string; tenantId: string }; ctx: Ctx }, authAt = Date.now() - 60_000) => ({
    ...signedInToken({ sub: who.user.id }, { role: who.ctx.role, tenantId: who.user.tenantId, mfa: true }, authAt),
    checkedAt: 0,
  });

  it("their own password change: every session, the second step passed or not; the next needs the code again", async () => {
    const laura = await enrolled();
    const session = sessionOf(laura);
    expect(await refreshSessionToken(session)).toMatchObject({ mfa: true });

    await usersService.changeMyPassword(laura.ctx, { currentPassword: PASSWORD, newPassword: NEXT });

    expect(await refreshSessionToken(session, afterGrace())).toBeNull();
    // The new password alone is not a session, and two-step verification is as it was.
    expect(await signIn(NEXT)).toBe("mfa_required");
    expect(await mfaService.getStatus(laura.ctx)).toMatchObject({ enabled: true, recoveryCodesLeft: 10 });
    const again = await signIn(NEXT, appCode(laura.secret));
    expect(again).toMatchObject({ id: laura.user.id, mfa: true });
    // The session of that sign-in lives on, with its claim.
    const changedAt = (await db.query.users.findFirst({ where: eq(users.id, laura.user.id) }))!.passwordChangedAt!.getTime();
    expect(await refreshSessionToken(sessionOf(laura, changedAt + 1), afterGrace())).toMatchObject({ sub: laura.user.id, mfa: true });
  });

  it("an admin's password reset: theirs only, and the second step stays on (a reset is no way around it)", async () => {
    const tenant = await createTestTenant();
    const admin = await enrolled("admin@example.com", "admin", tenant.id);
    const marcos = await enrolled("marcos@example.com", "viewer", tenant.id);
    const sessions = { marcos: sessionOf(marcos), admin: sessionOf(admin) };

    await usersService.resetUserPassword(admin.ctx, marcos.user.id, { password: NEXT });

    expect(await refreshSessionToken(sessions.marcos, afterGrace())).toBeNull();
    expect(await refreshSessionToken(sessions.admin, afterGrace())).toMatchObject({ sub: admin.user.id, mfa: true });
    expect(await signIn(NEXT, undefined, "marcos@example.com")).toBe("mfa_required");
    expect(await signIn(PASSWORD, appCode(marcos.secret), "marcos@example.com")).toBeNull();
    expect(await signIn(NEXT, appCode(marcos.secret), "marcos@example.com")).toMatchObject({ id: marcos.user.id, mfa: true });
  });

  it("deactivation: at once, whatever the code; activated again, the old sessions stay ended and both steps are asked", async () => {
    const tenant = await createTestTenant();
    const admin = await staff("admin@example.com", "admin", tenant.id);
    const marcos = await enrolled("marcos@example.com", "viewer", tenant.id);
    const old = sessionOf(marcos);

    await usersService.updateUser(admin.ctx, marcos.user.id, { active: false });

    // No grace for a deactivated user, and no sign-in: the right password and code answer like a wrong password.
    expect(await refreshSessionToken(old)).toBeNull();
    expect(await signIn(PASSWORD, appCode(marcos.secret), "marcos@example.com")).toBeNull();

    await usersService.updateUser(admin.ctx, marcos.user.id, { active: true });

    expect(await refreshSessionToken(old, afterGrace())).toBeNull();
    expect(await mfaService.getStatus(marcos.ctx)).toMatchObject({ enabled: true });
    expect(await signIn(PASSWORD, undefined, "marcos@example.com")).toBe("mfa_required");
    expect(await signIn(PASSWORD, appCode(marcos.secret), "marcos@example.com")).toMatchObject({ id: marcos.user.id, mfa: true });
  });

  it("switching it on or off is not one of them: the session at hand carries on as it signed in", async () => {
    const laura = await staff();
    const passwordOnly = { ...signedInToken({ sub: laura.user.id }, { role: "manager", tenantId: laura.user.tenantId }, Date.now() - 60_000), checkedAt: 0 };
    const { secret } = await mfaService.beginEnrolment(laura.ctx);
    await mfaService.confirmEnrolment(laura.ctx, { code: appCode(secret, -2) }, new Date(Date.now() - 2 * TOTP_STEP_SECONDS * 1000));

    // On from the next sign-in: this session is not ended, and does not gain the claim.
    const kept = await refreshSessionToken(passwordOnly, afterGrace());
    expect(kept).toMatchObject({ sub: laura.user.id });
    expect(kept).not.toHaveProperty("mfa");
    expect(await signIn(PASSWORD)).toBe("mfa_required");

    await mfaService.disable(laura.ctx, { password: PASSWORD, code: appCode(secret) });

    expect(await refreshSessionToken(passwordOnly, afterGrace())).toMatchObject({ sub: laura.user.id });
    expect(await signIn(PASSWORD)).toMatchObject({ id: laura.user.id, mfa: false });
  });
});
