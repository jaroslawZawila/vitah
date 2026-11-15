import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, userMfa, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase, withoutTable } from "@repo/db/testing";
import { mfaService as svc, usersService, type Ctx } from "../src";
import { base32Decode, totp, TOTP_STEP_SECONDS } from "../src/totp";

const PASSWORD = "CasaNordica26";
/** Mid-step, so "a step earlier" and "a step later" are exactly that. */
const NOW = new Date("2026-11-14T10:00:15.000Z");
const STEP_MS = TOTP_STEP_SECONDS * 1000;
const later = (steps: number) => new Date(NOW.getTime() + steps * STEP_MS);

/** What the user's authenticator shows at `at`, for the secret enrolling gave them. */
const appCode = (secret: string, at = NOW) => totp(base32Decode(secret)!, at.getTime());
/** Six digits that are not the code of any accepted step at `at`. */
function wrongCode(secret: string, at = NOW) {
  const taken = [-1, 0, 1].map((steps) => appCode(secret, new Date(at.getTime() + steps * STEP_MS)));
  return ["000000", "111111", "222222", "333333"].find((code) => !taken.includes(code))!;
}

async function staff(role: "admin" | "manager" | "viewer" = "manager", tenantId?: string) {
  const tenant = tenantId ?? (await createTestTenant()).id;
  const user = await createTestUser(tenant, { role, password: PASSWORD });
  const ctx: Ctx = { tenantId: tenant, userId: user.id, role };
  return { user, ctx };
}

/** A user with two-step verification on: their secret (as the app holds it) and recovery codes. */
async function enrolled(role: "admin" | "manager" | "viewer" = "manager", tenantId?: string) {
  const { user, ctx } = await staff(role, tenantId);
  const { secret } = await svc.beginEnrolment(ctx);
  // Confirmed a few minutes ago: the codes of NOW are all still to be used.
  const { recoveryCodes } = await svc.confirmEnrolment(ctx, { code: appCode(secret, later(-10)) }, later(-10));
  return { user, ctx, secret, recoveryCodes };
}

const row = (userId: string) => db.query.userMfa.findFirst({ where: eq(userMfa.userId, userId) });
const reloadUser = async (id: string) => (await db.query.users.findFirst({ where: eq(users.id, id) }))!;

beforeEach(async () => {
  vi.stubEnv("NEXTAUTH_SECRET", "test-secret");
  await resetDatabase();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("enrolling", () => {
  it("gives the secret as text, as an otpauth URI and as a QR code, and keeps it encrypted", async () => {
    const { user, ctx } = await staff();

    const enrolment = await svc.beginEnrolment(ctx);

    expect(enrolment.secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(enrolment.uri).toBe(
      `otpauth://totp/ViTAH:${encodeURIComponent(user.email)}?secret=${enrolment.secret}&issuer=ViTAH`,
    );
    expect(enrolment.qr).toMatch(/^data:image\/svg\+xml;base64,/);
    const svg = Buffer.from(enrolment.qr.split(",")[1]!, "base64").toString();
    expect(svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 \d+ \d+"/);
    // Drawn here: nothing in it is loaded from anywhere.
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(/https?:|href|<script|<image/);

    const stored = (await row(user.id))!;
    expect(stored).toMatchObject({ tenantId: ctx.tenantId, confirmedAt: null, recoveryCodes: [], lastStep: null });
    expect(stored.secret).toMatch(/^v1\./);
    expect(stored.secret).not.toContain(enrolment.secret);
    expect(JSON.stringify(stored)).not.toContain(base32Decode(enrolment.secret)!.toString("base64url"));
  });

  it("does not gate sign-in until it is confirmed", async () => {
    const { user, ctx } = await staff();
    const { secret } = await svc.beginEnrolment(ctx);

    expect(await svc.getStatus(ctx)).toEqual({ enabled: false, recoveryCodesLeft: 0 });
    expect(await svc.checkSignInCode(user.id, undefined, NOW)).toBe("off");
    expect(await svc.checkSignInCode(user.id, appCode(secret), NOW)).toBe("off");
  });

  it("is not switched on by a wrong code", async () => {
    const { user, ctx } = await staff();
    const { secret } = await svc.beginEnrolment(ctx);

    await expect(svc.confirmEnrolment(ctx, { code: wrongCode(secret) }, NOW)).rejects.toMatchObject({
      code: "wrong_code",
      status: 400,
    });
    // Nor by the code of two steps ago, or by something that is no code.
    await expect(svc.confirmEnrolment(ctx, { code: appCode(secret, later(-2)) }, NOW)).rejects.toMatchObject({
      code: "wrong_code",
    });
    await expect(svc.confirmEnrolment(ctx, { code: "ABCDE-FGHJK" }, NOW)).rejects.toMatchObject({ code: "wrong_code" });

    expect(await svc.getStatus(ctx)).toEqual({ enabled: false, recoveryCodesLeft: 0 });
    expect((await row(user.id))!.confirmedAt).toBeNull();
    expect(await svc.checkSignInCode(user.id, undefined, NOW)).toBe("off");
  });

  it.each([{}, { code: "" }, { code: "   " }, { code: 123456 }])("asks for a code: %j", async (input) => {
    const { ctx } = await staff();
    await svc.beginEnrolment(ctx);

    await expect(svc.confirmEnrolment(ctx, input, NOW)).rejects.toMatchObject({ code: "missing_fields" });
  });

  it("cannot be confirmed before it is begun", async () => {
    const { ctx } = await staff();

    await expect(svc.confirmEnrolment(ctx, { code: "123456" }, NOW)).rejects.toMatchObject({
      code: "mfa_not_started",
    });
  });

  it("is on once one valid code confirms it, with ten recovery codes shown that once", async () => {
    const { user, ctx } = await staff();
    const { secret } = await svc.beginEnrolment(ctx);

    const { recoveryCodes } = await svc.confirmEnrolment(ctx, { code: appCode(secret) }, NOW);

    expect(recoveryCodes).toHaveLength(10);
    expect(new Set(recoveryCodes).size).toBe(10);
    for (const code of recoveryCodes) expect(code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
    expect(await svc.getStatus(ctx)).toEqual({ enabled: true, recoveryCodesLeft: 10 });
    expect(await svc.checkSignInCode(user.id, undefined, NOW)).toBe("required");

    // Kept as salted hashes: no code, and no two the same salt.
    const stored = (await row(user.id))!;
    expect(stored.confirmedAt).toEqual(NOW);
    expect(stored.recoveryCodes).toHaveLength(10);
    expect(new Set(stored.recoveryCodes.map((c) => c.salt)).size).toBe(10);
    for (const code of recoveryCodes) {
      expect(JSON.stringify(stored)).not.toContain(code);
      expect(JSON.stringify(stored)).not.toContain(code.replace("-", ""));
    }
  });

  it("accepts the code typed with a space in the middle", async () => {
    const { ctx } = await staff();
    const { secret } = await svc.beginEnrolment(ctx);
    const code = appCode(secret);

    await svc.confirmEnrolment(ctx, { code: `${code.slice(0, 3)} ${code.slice(3)}` }, NOW);

    expect((await svc.getStatus(ctx)).enabled).toBe(true);
  });

  it("starts over with a new secret while unconfirmed: the first one's codes no longer confirm", async () => {
    const { ctx } = await staff();
    const first = await svc.beginEnrolment(ctx);
    const second = await svc.beginEnrolment(ctx);

    expect(second.secret).not.toBe(first.secret);
    await expect(svc.confirmEnrolment(ctx, { code: appCode(first.secret) }, NOW)).rejects.toMatchObject({
      code: "wrong_code",
    });
    await svc.confirmEnrolment(ctx, { code: appCode(second.secret) }, NOW);
    expect((await svc.getStatus(ctx)).enabled).toBe(true);
  });

  it("cannot be begun or confirmed again once on: the secret in use is never replaced", async () => {
    const { user, ctx, secret } = await enrolled();
    const before = (await row(user.id))!;

    await expect(svc.beginEnrolment(ctx)).rejects.toMatchObject({ code: "mfa_already_enabled", status: 409 });
    await expect(svc.confirmEnrolment(ctx, { code: appCode(secret) }, NOW)).rejects.toMatchObject({
      code: "mfa_already_enabled",
      status: 409,
    });

    expect(await row(user.id)).toEqual(before);
  });

  it("refuses the eleventh wrong code in a row, the right one included, for a while", async () => {
    const { ctx } = await staff();
    const { secret } = await svc.beginEnrolment(ctx);
    for (let i = 0; i < 10; i++) {
      await expect(svc.confirmEnrolment(ctx, { code: wrongCode(secret) }, NOW)).rejects.toMatchObject({
        code: "wrong_code",
      });
    }

    await expect(svc.confirmEnrolment(ctx, { code: appCode(secret) }, NOW)).rejects.toMatchObject({
      code: "too_many_attempts",
      status: 429,
    });
    expect((await svc.getStatus(ctx)).enabled).toBe(false);
  });

  it("is each user's own: one enrolling changes nothing for a colleague", async () => {
    const tenant = await createTestTenant();
    const laura = await enrolled("admin", tenant.id);
    const marcos = await staff("viewer", tenant.id);

    expect(await svc.getStatus(marcos.ctx)).toEqual({ enabled: false, recoveryCodesLeft: 0 });
    expect(await svc.checkSignInCode(marcos.user.id, appCode(laura.secret), NOW)).toBe("off");
  });

  it("is not for someone deactivated since they signed in", async () => {
    const { user, ctx } = await staff();
    await db.update(users).set({ active: false }).where(eq(users.id, user.id));

    await expect(svc.beginEnrolment(ctx)).rejects.toMatchObject({ code: "not_found" });
    expect(await row(user.id)).toBeUndefined();
  });
});

describe("the second step of signing in", () => {
  it("is off for a user who never enrolled, code or no code", async () => {
    const { user } = await staff();

    expect(await svc.checkSignInCode(user.id, undefined, NOW)).toBe("off");
    expect(await svc.checkSignInCode(user.id, "123456", NOW)).toBe("off");
  });

  it.each([undefined, "", "   "])("asks for a code when none came (%j)", async (code) => {
    const { user } = await enrolled();

    expect(await svc.checkSignInCode(user.id, code, NOW)).toBe("required");
  });

  it.each([
    ["the current step's", 0],
    ["the previous step's (a slow clock)", -1],
    ["the next step's (a fast clock)", 1],
  ])("passes with %s code", async (_which, steps) => {
    const { user, secret } = await enrolled();

    expect(await svc.checkSignInCode(user.id, appCode(secret, later(steps)), NOW)).toBe("passed");
  });

  it.each([-2, 2])("fails with the code of %i steps away", async (steps) => {
    const { user, secret } = await enrolled();

    expect(await svc.checkSignInCode(user.id, appCode(secret, later(steps)), NOW)).toBe("failed");
  });

  it("fails with a wrong code, and changes nothing", async () => {
    const { user, secret } = await enrolled();
    const before = await row(user.id);

    expect(await svc.checkSignInCode(user.id, wrongCode(secret), NOW)).toBe("failed");
    expect(await svc.checkSignInCode(user.id, "not a code", NOW)).toBe("failed");
    expect(await row(user.id)).toEqual(before);
  });

  it("refuses a code a second time in its step, and any earlier one after it", async () => {
    const { user, secret } = await enrolled();
    const code = appCode(secret);

    expect(await svc.checkSignInCode(user.id, code, NOW)).toBe("passed");
    expect(await svc.checkSignInCode(user.id, code, NOW)).toBe("failed");
    // Still inside its window a moment later, and still refused.
    expect(await svc.checkSignInCode(user.id, code, later(1))).toBe("failed");
    // The step before it was never used, but is behind the last one accepted.
    expect(await svc.checkSignInCode(user.id, appCode(secret, later(-1)), NOW)).toBe("failed");
    // The next step's code is new.
    expect(await svc.checkSignInCode(user.id, appCode(secret, later(1)), later(1))).toBe("passed");
  });

  it("refuses the very code that confirmed the enrolment", async () => {
    const { user, ctx } = await staff();
    const { secret } = await svc.beginEnrolment(ctx);
    await svc.confirmEnrolment(ctx, { code: appCode(secret) }, NOW);

    expect(await svc.checkSignInCode(user.id, appCode(secret), NOW)).toBe("failed");
  });

  it("lets one of two simultaneous uses of a code through, never both", async () => {
    const { user, secret } = await enrolled();
    const code = appCode(secret);

    const results = await Promise.all(Array.from({ length: 6 }, () => svc.checkSignInCode(user.id, code, NOW)));

    expect(results.filter((r) => r === "passed")).toHaveLength(1);
    expect(results.filter((r) => r === "failed")).toHaveLength(5);
  });

  it("takes a recovery code once, however it is typed", async () => {
    const { user, ctx, recoveryCodes } = await enrolled();
    const [first, second] = recoveryCodes as [string, string];

    expect(await svc.checkSignInCode(user.id, first, NOW)).toBe("passed");
    expect(await svc.checkSignInCode(user.id, first, later(5))).toBe("failed");
    expect(await svc.getStatus(ctx)).toEqual({ enabled: true, recoveryCodesLeft: 9 });
    // Lower case, no dash, spaces around.
    expect(await svc.checkSignInCode(user.id, ` ${second.toLowerCase().replace("-", "")} `, NOW)).toBe("passed");
    expect(await svc.getStatus(ctx)).toEqual({ enabled: true, recoveryCodesLeft: 8 });

    const spent = (await row(user.id))!.recoveryCodes.filter((c) => c.usedAt !== null);
    expect(spent.map((c) => c.usedAt)).toEqual([NOW.toISOString(), NOW.toISOString()]);
  });

  it("lets one of two simultaneous uses of a recovery code through", async () => {
    const { user, recoveryCodes } = await enrolled();

    const results = await Promise.all(
      Array.from({ length: 4 }, () => svc.checkSignInCode(user.id, recoveryCodes[0], NOW)),
    );

    expect(results.filter((r) => r === "passed")).toHaveLength(1);
  });

  it("fails with a recovery code that was never given", async () => {
    const { user } = await enrolled();

    expect(await svc.checkSignInCode(user.id, "AAAAA-AAAAA", NOW)).toBe("failed");
  });

  it("fails with something far too long to be a code, a real code inside it or not", async () => {
    const { user, recoveryCodes } = await enrolled();

    expect(await svc.checkSignInCode(user.id, "x".repeat(100_000), NOW)).toBe("failed");
    expect(await svc.checkSignInCode(user.id, `${" ".repeat(80)}${recoveryCodes[0]}`, NOW)).toBe("failed");
    expect(await svc.checkSignInCode(user.id, recoveryCodes[0], NOW)).toBe("passed");
  });

  it("takes only the user's own codes: a colleague's app or recovery code fails", async () => {
    const tenant = await createTestTenant();
    const laura = await enrolled("admin", tenant.id);
    const marcos = await enrolled("viewer", tenant.id);
    const stranger = await enrolled("admin");

    for (const other of [marcos, stranger]) {
      expect(await svc.checkSignInCode(laura.user.id, appCode(other.secret), NOW)).toBe("failed");
      expect(await svc.checkSignInCode(laura.user.id, other.recoveryCodes[0], NOW)).toBe("failed");
    }
    expect(await svc.checkSignInCode(laura.user.id, appCode(laura.secret), NOW)).toBe("passed");
    expect(await svc.getStatus(marcos.ctx)).toEqual({ enabled: true, recoveryCodesLeft: 10 });
  });

  it("is off, with a warning, while the table is not there yet (deployed ahead of its SQL)", async () => {
    const { user } = await enrolled();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(await withoutTable("user_mfa", () => svc.checkSignInCode(user.id, undefined, NOW))).toBe("off");

    expect(warn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(warn.mock.calls[0]![0] as string)).toMatchObject({ level: "warn", event: "mfa.table_missing" });
    expect(await svc.checkSignInCode(user.id, undefined, NOW)).toBe("required");
  });
});

describe("while the table is not there yet (the portal deployed ahead of its SQL)", () => {
  const unavailable = { code: "mfa_unavailable", status: 503 };
  const warnings = (warn: { mock: { calls: unknown[][] } }) => warn.mock.calls.map((call) => (JSON.parse(call[0] as string) as { event: string }).event);

  it("answers mfa_unavailable to everything a user or an admin does with it, never a database error", async () => {
    const admin = await staff("admin");
    const laura = await enrolled("manager", admin.ctx.tenantId);
    const fresh = await staff("viewer", admin.ctx.tenantId);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await withoutTable("user_mfa", async () => {
      await expect(svc.getStatus(laura.ctx)).rejects.toMatchObject(unavailable);
      await expect(svc.beginEnrolment(fresh.ctx)).rejects.toMatchObject(unavailable);
      await expect(svc.confirmEnrolment(fresh.ctx, { code: "123456" }, NOW)).rejects.toMatchObject(unavailable);
      await expect(svc.disable(laura.ctx, { password: PASSWORD, code: appCode(laura.secret) }, NOW)).rejects.toMatchObject(unavailable);
      await expect(svc.regenerateRecoveryCodes(laura.ctx, { code: appCode(laura.secret) }, NOW)).rejects.toMatchObject(unavailable);
      await expect(svc.removeUserMfa(admin.ctx, laura.user.id)).rejects.toMatchObject(unavailable);
      // What never reaches the table answers as ever.
      await expect(svc.removeUserMfa(admin.ctx, admin.user.id)).rejects.toMatchObject({ code: "cannot_remove_own_mfa" });
      await expect(svc.removeUserMfa(laura.ctx, admin.user.id)).rejects.toMatchObject({ code: "forbidden" });
    });

    expect(warnings(warn)).toEqual(Array.from({ length: 6 }, () => "mfa.table_missing"));
    // The table back, nothing was changed meanwhile: Laura's is on, her code unspent, her sessions untouched.
    expect(await svc.getStatus(laura.ctx)).toEqual({ enabled: true, recoveryCodesLeft: 10 });
    expect(await svc.checkSignInCode(laura.user.id, appCode(laura.secret), NOW)).toBe("passed");
    expect((await reloadUser(laura.user.id)).passwordChangedAt).toBeNull();
    const { secret } = await svc.beginEnrolment(fresh.ctx);
    await expect(svc.confirmEnrolment(fresh.ctx, { code: appCode(secret) }, NOW)).resolves.toMatchObject({ recoveryCodes: expect.any(Array) });
  });

  it("lists the staff with two-step verification off for everyone, with a warning", async () => {
    const admin = await staff("admin");
    const laura = await enrolled("manager", admin.ctx.tenantId);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const listed = async () => (await usersService.listUsers(admin.ctx)).map((user) => [user.id, user.mfaEnabled]);

    expect(await withoutTable("user_mfa", listed)).toEqual([
      [admin.user.id, false],
      [laura.user.id, false],
    ]);

    expect(warnings(warn)).toEqual(["mfa.table_missing"]);
    expect(await listed()).toEqual([
      [admin.user.id, false],
      [laura.user.id, true],
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("does not take another failure for a missing table", async () => {
    const admin = await staff("admin");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    // Another table gone is not this one: the error stays what it is.
    await withoutTable("users", async () => {
      await expect(usersService.listUsers(admin.ctx)).rejects.not.toMatchObject({ code: "mfa_unavailable" });
      await expect(svc.removeUserMfa(admin.ctx, crypto.randomUUID())).rejects.not.toMatchObject({ code: "mfa_unavailable" });
    });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("after NEXTAUTH_SECRET is rotated", () => {
  it("no app code is right any more, a recovery code still is, and enrolling again works", async () => {
    const { user, ctx, secret, recoveryCodes } = await enrolled();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("NEXTAUTH_SECRET", "the-secret-after-a-rotation");

    // Still asked for, and failing cleanly: no error, a line in the log.
    expect(await svc.checkSignInCode(user.id, undefined, NOW)).toBe("required");
    expect(await svc.checkSignInCode(user.id, appCode(secret), NOW)).toBe("failed");
    const line = JSON.parse(warn.mock.calls[0]![0] as string);
    expect(line).toMatchObject({ level: "warn", event: "mfa.secret_unreadable", userId: user.id });
    expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);

    expect(await svc.checkSignInCode(user.id, recoveryCodes[0], NOW)).toBe("passed");
    await svc.disable(ctx, { password: PASSWORD, code: recoveryCodes[1] }, NOW);
    const again = await svc.beginEnrolment(ctx);
    await svc.confirmEnrolment(ctx, { code: appCode(again.secret) }, NOW);
    expect(await svc.checkSignInCode(user.id, appCode(again.secret, later(1)), later(1))).toBe("passed");
  });

  it("an admin can still remove it", async () => {
    const tenant = await createTestTenant();
    const admin = await staff("admin", tenant.id);
    const marcos = await enrolled("viewer", tenant.id);
    vi.stubEnv("NEXTAUTH_SECRET", "the-secret-after-a-rotation");

    await svc.removeUserMfa(admin.ctx, marcos.user.id);

    expect(await svc.checkSignInCode(marcos.user.id, undefined, NOW)).toBe("off");
  });
});

describe("turning it off", () => {
  it("needs the current password and a valid code", async () => {
    const { user, ctx, secret } = await enrolled();

    await svc.disable(ctx, { password: PASSWORD, code: appCode(secret) }, NOW);

    expect(await row(user.id)).toBeUndefined();
    expect(await svc.getStatus(ctx)).toEqual({ enabled: false, recoveryCodesLeft: 0 });
    expect(await svc.checkSignInCode(user.id, undefined, NOW)).toBe("off");
  });

  it("takes a recovery code in place of the app's", async () => {
    const { user, ctx, recoveryCodes } = await enrolled();

    expect(await svc.disable(ctx, { password: PASSWORD, code: recoveryCodes[3] }, NOW)).toEqual({ success: true });

    expect(await row(user.id)).toBeUndefined();
  });

  it("stays on with a wrong password, however right the code", async () => {
    const { user, ctx, secret } = await enrolled();

    await expect(svc.disable(ctx, { password: "NotThisOne26", code: appCode(secret) }, NOW)).rejects.toMatchObject({
      code: "wrong_password",
      status: 400,
    });

    expect((await svc.getStatus(ctx)).enabled).toBe(true);
    // The code was not spent on it.
    expect(await svc.checkSignInCode(user.id, appCode(secret), NOW)).toBe("passed");
  });

  it("stays on with a wrong code, however right the password", async () => {
    const { ctx, secret } = await enrolled();

    await expect(svc.disable(ctx, { password: PASSWORD, code: wrongCode(secret) }, NOW)).rejects.toMatchObject({
      code: "wrong_code",
      status: 400,
    });
    await expect(svc.disable(ctx, { password: PASSWORD, code: "AAAAA-AAAAA" }, NOW)).rejects.toMatchObject({
      code: "wrong_code",
    });

    expect(await svc.getStatus(ctx)).toEqual({ enabled: true, recoveryCodesLeft: 10 });
  });

  it("refuses a code already used to sign in", async () => {
    const { user, ctx, secret } = await enrolled();
    await svc.checkSignInCode(user.id, appCode(secret), NOW);

    await expect(svc.disable(ctx, { password: PASSWORD, code: appCode(secret) }, NOW)).rejects.toMatchObject({
      code: "wrong_code",
    });
  });

  it.each([{}, { password: PASSWORD }, { code: "123456" }, { password: "", code: "123456" }, { password: 1, code: 2 }])(
    "asks for both: %j",
    async (input) => {
      const { ctx } = await enrolled();

      await expect(svc.disable(ctx, input, NOW)).rejects.toMatchObject({ code: "missing_fields" });
      expect((await svc.getStatus(ctx)).enabled).toBe(true);
    },
  );

  it("says so when there is nothing to turn off", async () => {
    const { ctx } = await staff();
    await svc.beginEnrolment(ctx); // begun, never confirmed

    await expect(svc.disable(ctx, { password: PASSWORD, code: "123456" }, NOW)).rejects.toMatchObject({
      code: "mfa_not_enabled",
    });
  });

  it("refuses after ten wrong tries, sharing the allowance of wrong current passwords", async () => {
    const { ctx, secret } = await enrolled();
    for (let i = 0; i < 10; i++) {
      await expect(svc.disable(ctx, { password: "NotThisOne26", code: appCode(secret) }, NOW)).rejects.toMatchObject({
        code: "wrong_password",
      });
    }

    await expect(svc.disable(ctx, { password: PASSWORD, code: appCode(secret) }, NOW)).rejects.toMatchObject({
      code: "too_many_attempts",
      status: 429,
    });
    // The password counter is the one "change my password" checks too.
    await expect(
      usersService.changeMyPassword(ctx, { currentPassword: PASSWORD, newPassword: "OtraCasa2026" }),
    ).rejects.toMatchObject({ code: "too_many_attempts" });
    expect((await svc.getStatus(ctx)).enabled).toBe(true);
  });
});

describe("new recovery codes", () => {
  it("replace the old ones, spent or not, and are shown that once", async () => {
    const { user, ctx, secret, recoveryCodes: old } = await enrolled();
    await svc.checkSignInCode(user.id, old[0], NOW);

    const { recoveryCodes: fresh } = await svc.regenerateRecoveryCodes(ctx, { code: appCode(secret) }, NOW);

    expect(fresh).toHaveLength(10);
    expect(fresh.filter((code) => old.includes(code))).toEqual([]);
    expect(await svc.getStatus(ctx)).toEqual({ enabled: true, recoveryCodesLeft: 10 });
    for (const code of old) expect(await svc.checkSignInCode(user.id, code, NOW)).toBe("failed");
    expect(await svc.checkSignInCode(user.id, fresh[0], NOW)).toBe("passed");
  });

  it("can be asked for with an old recovery code", async () => {
    const { user, ctx, recoveryCodes: old } = await enrolled();

    const { recoveryCodes: fresh } = await svc.regenerateRecoveryCodes(ctx, { code: old[0] }, NOW);

    expect(await svc.checkSignInCode(user.id, old[1], NOW)).toBe("failed");
    expect(await svc.checkSignInCode(user.id, fresh[9], NOW)).toBe("passed");
  });

  it("need a valid code: a wrong one, or none, leaves the old ones working", async () => {
    const { user, ctx, secret, recoveryCodes: old } = await enrolled();

    await expect(svc.regenerateRecoveryCodes(ctx, { code: wrongCode(secret) }, NOW)).rejects.toMatchObject({
      code: "wrong_code",
    });
    await expect(svc.regenerateRecoveryCodes(ctx, {}, NOW)).rejects.toMatchObject({ code: "missing_fields" });

    expect(await svc.checkSignInCode(user.id, old[0], NOW)).toBe("passed");
  });

  it("are not for someone without two-step verification", async () => {
    const { ctx } = await staff();

    await expect(svc.regenerateRecoveryCodes(ctx, { code: "123456" }, NOW)).rejects.toMatchObject({
      code: "mfa_not_enabled",
    });
  });
});

describe("an admin removing someone's two-step verification", () => {
  async function office() {
    const tenant = await createTestTenant();
    const admin = await enrolled("admin", tenant.id);
    const marcos = await enrolled("viewer", tenant.id);
    return { tenant, admin, marcos };
  }

  it("deletes it and ends that user's sessions; they sign in with the password alone", async () => {
    const { admin, marcos } = await office();
    const before = Date.now();

    expect(await svc.removeUserMfa(admin.ctx, marcos.user.id)).toEqual({ id: marcos.user.id });

    expect(await row(marcos.user.id)).toBeUndefined();
    expect(await svc.checkSignInCode(marcos.user.id, undefined, NOW)).toBe("off");
    // The mark every session and token is checked against (@repo/auth's revokedByPasswordChange).
    const changed = (await reloadUser(marcos.user.id)).passwordChangedAt!;
    expect(changed.getTime()).toBeGreaterThanOrEqual(before);
    // The password itself is untouched, and so is everyone else.
    expect((await reloadUser(marcos.user.id)).passwordHash).toBe(marcos.user.passwordHash);
    expect((await reloadUser(admin.user.id)).passwordChangedAt).toBeNull();
    expect((await svc.getStatus(admin.ctx)).enabled).toBe(true);
    // And they may enrol again.
    await svc.beginEnrolment(marcos.ctx);
  });

  it.each(["manager", "viewer"] as const)("is forbidden to a %s", async (role) => {
    const { tenant, marcos } = await office();
    const { ctx } = await staff(role, tenant.id);

    await expect(svc.removeUserMfa(ctx, marcos.user.id)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect((await svc.getStatus(marcos.ctx)).enabled).toBe(true);
  });

  it("answers not found for a user of another tenant, a client or nobody", async () => {
    const { tenant, admin } = await office();
    const stranger = await enrolled("viewer");
    const client = await createTestUser(tenant.id, { role: "client" });

    for (const id of [stranger.user.id, client.id, "no-such-user"]) {
      await expect(svc.removeUserMfa(admin.ctx, id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    }
    expect((await svc.getStatus(stranger.ctx)).enabled).toBe(true);
    expect((await reloadUser(stranger.user.id)).passwordChangedAt).toBeNull();
  });

  it("is not for the admin's own", async () => {
    const { admin } = await office();

    await expect(svc.removeUserMfa(admin.ctx, admin.user.id)).rejects.toMatchObject({
      code: "cannot_remove_own_mfa",
      status: 400,
    });
    expect((await svc.getStatus(admin.ctx)).enabled).toBe(true);
    expect((await reloadUser(admin.user.id)).passwordChangedAt).toBeNull();
  });

  it("says so when the user has none, signing nobody out", async () => {
    const { tenant, admin } = await office();
    const plain = await staff("manager", tenant.id);
    const begun = await staff("manager", tenant.id);
    await svc.beginEnrolment(begun.ctx);

    for (const { user } of [plain, begun]) {
      await expect(svc.removeUserMfa(admin.ctx, user.id)).rejects.toMatchObject({ code: "mfa_not_enabled" });
      expect((await reloadUser(user.id)).passwordChangedAt).toBeNull();
    }
    // An enrolment under way is left as it was.
    expect(await row(begun.user.id)).toBeDefined();
  });
});

describe("tenant isolation", () => {
  it("a context of another tenant reads and changes nothing of the user's", async () => {
    const { user, secret, recoveryCodes } = await enrolled();
    const other = await createTestTenant();
    const forged: Ctx = { tenantId: other.id, userId: user.id, role: "admin" };

    expect(await svc.getStatus(forged)).toEqual({ enabled: false, recoveryCodesLeft: 0 });
    await expect(svc.beginEnrolment(forged)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.confirmEnrolment(forged, { code: appCode(secret) }, NOW)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(svc.disable(forged, { password: PASSWORD, code: appCode(secret) }, NOW)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(svc.regenerateRecoveryCodes(forged, { code: recoveryCodes[0] }, NOW)).rejects.toMatchObject({
      code: "not_found",
    });

    expect((await row(user.id))!.confirmedAt).not.toBeNull();
    expect(await svc.checkSignInCode(user.id, recoveryCodes[0], NOW)).toBe("passed");
  });

  it("the staff list says who has it on, for the admin's own tenant only", async () => {
    const tenant = await createTestTenant();
    const admin = await enrolled("admin", tenant.id);
    const begun = await staff("manager", tenant.id);
    await svc.beginEnrolment(begun.ctx);
    const plain = await staff("viewer", tenant.id);
    await enrolled("admin"); // another tenant's

    const list = await usersService.listUsers(admin.ctx);

    expect(Object.fromEntries(list.map((u) => [u.id, u.mfaEnabled]))).toEqual({
      [admin.user.id]: true,
      [begun.user.id]: false,
      [plain.user.id]: false,
    });
  });

  it("goes with its user: deleting the user deletes it", async () => {
    const { user } = await enrolled();

    await db.delete(users).where(eq(users.id, user.id));

    expect(await row(user.id)).toBeUndefined();
  });
});

describe("what is never answered or logged", () => {
  it("the secret after enrolling, and the stored hashes, in any result", async () => {
    const logs = [vi.spyOn(console, "warn"), vi.spyOn(console, "error")].map((spy) => spy.mockImplementation(() => {}));
    const tenant = await createTestTenant();
    const admin = await staff("admin", tenant.id);
    const { user, ctx } = await staff("manager", tenant.id);

    const enrolment = await svc.beginEnrolment(ctx);
    const confirmed = await svc.confirmEnrolment(ctx, { code: appCode(enrolment.secret) }, NOW);
    const sealed = (await row(user.id))!;
    const results = [
      confirmed,
      await svc.getStatus(ctx),
      await svc.checkSignInCode(user.id, appCode(enrolment.secret, later(1)), later(1)),
      await svc.checkSignInCode(user.id, "000000", later(1)),
      await svc.regenerateRecoveryCodes(ctx, { code: appCode(enrolment.secret, later(2)) }, later(2)),
      await usersService.listUsers(admin.ctx),
      await usersService.getMe(ctx),
      await svc.disable(ctx, { password: "wrong" + PASSWORD, code: "000000" }, later(3)).catch((error: unknown) => ({
        ...(error as object),
        message: (error as Error).message,
      })),
      await svc.removeUserMfa(admin.ctx, user.id),
    ];

    const said = JSON.stringify([results, logs.map((spy) => spy.mock.calls)]);
    const secrets = [
      enrolment.secret,
      base32Decode(enrolment.secret)!.toString("hex"),
      base32Decode(enrolment.secret)!.toString("base64"),
      sealed.secret,
      ...sealed.recoveryCodes.flatMap((code) => [code.hash, code.salt]),
    ];
    for (const secret of secrets) expect(said).not.toContain(secret);
    // Only the two answers that exist to show codes carry any.
    expect(JSON.stringify(results.slice(1, 4))).not.toMatch(/[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}/);
    expect(JSON.stringify(results.slice(5))).not.toMatch(/[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}/);
  });
});

describe("input boundaries (schemas in src/inputs/accounts.ts)", () => {
  it("asks for what is missing before anything else, as before; extra keys are ignored", async () => {
    const nobody: Ctx = { tenantId: (await createTestTenant()).id, userId: crypto.randomUUID(), role: "manager" };
    for (const input of [{ code: null }, { code: ["123456"] }]) {
      await expect(svc.confirmEnrolment(nobody, input, NOW)).rejects.toMatchObject({ code: "missing_fields", status: 400 });
      await expect(svc.regenerateRecoveryCodes(nobody, input, NOW)).rejects.toMatchObject({ code: "missing_fields" });
      await expect(svc.disable(nobody, { ...input, password: PASSWORD }, NOW)).rejects.toMatchObject({ code: "missing_fields" });
    }

    const { ctx, secret } = await enrolled();
    await svc.disable(ctx, { password: PASSWORD, code: appCode(secret), userId: "someone-else", enabled: true }, NOW);
    expect((await svc.getStatus(ctx)).enabled).toBe(false);
  });
});
