import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, userMfa, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase, withoutTable } from "@repo/db/testing";
import { mfaService, type Ctx } from "@repo/core";
import { base32Decode, totp } from "@repo/core/totp";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import { signInAs } from "../../test/session";
import { TO_LOGIN } from "../../test/navigation";
import {
  beginMfaAction,
  confirmMfaAction,
  disableMfaAction,
  getMfaStatus,
  regenerateRecoveryCodesAction,
} from "./mfa";
import { getUsers, removeUserMfaAction } from "./users";

vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@repo/auth", () => ({ AuthError: class AuthError extends Error {} }));
vi.mock("../../auth", () => ({ signIn: vi.fn(), signOut: vi.fn() }));
const { revalidatePath } = await import("next/cache");

const PASSWORD = "CasaNordica26";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** The app's code `steps` half-minutes from now. */
const appCode = (secret: string, steps = 0) => totp(base32Decode(secret)!, Date.now() + steps * 30_000);

async function staff(role: "admin" | "manager" | "viewer" = "viewer", tenantId?: string) {
  const tenant = tenantId ?? (await createTestTenant()).id;
  const user = await createTestUser(tenant, { role, password: PASSWORD });
  const ctx: Ctx = { tenantId: tenant, userId: user.id, role };
  return { user, ctx };
}

/** A user with two-step verification on, confirmed five minutes ago. */
async function enrolled(role: "admin" | "manager" | "viewer" = "viewer", tenantId?: string) {
  const account = await staff(role, tenantId);
  const { secret } = await mfaService.beginEnrolment(account.ctx);
  const then = new Date(Date.now() - 300_000);
  const { recoveryCodes } = await mfaService.confirmEnrolment(
    account.ctx,
    { code: totp(base32Decode(secret)!, then.getTime()) },
    then,
  );
  return { ...account, secret, recoveryCodes };
}

const row = (userId: string) => db.query.userMfa.findFirst({ where: eq(userMfa.userId, userId) });

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
});

describe("the two-step verification actions", () => {
  it("enrols the signed-in user, whatever their role: begin, then confirm with the form's code", async () => {
    const { user, ctx } = await staff("viewer");
    signInAs(ctx);
    expect(await getMfaStatus()).toEqual({ enabled: false, recoveryCodesLeft: 0 });

    const { enrolment } = await beginMfaAction();
    expect(enrolment).toMatchObject({ secret: expect.stringMatching(/^[A-Z2-7]{32}$/), qr: expect.stringMatching(/^data:image\/svg\+xml;base64,/) });
    // Nothing to show differently yet.
    expect(revalidatePath).not.toHaveBeenCalled();

    const confirmed = await confirmMfaAction(form({ code: appCode(enrolment!.secret) }));

    expect(confirmed.recoveryCodes).toHaveLength(10);
    expect(confirmed).not.toHaveProperty("error");
    expect(await getMfaStatus()).toEqual({ enabled: true, recoveryCodesLeft: 10 });
    expect((await row(user.id))!.confirmedAt).toBeInstanceOf(Date);
    // The rail re-reads the state.
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/dashboard", "layout");
  });

  it("answers a wrong code as form state, and switches nothing on", async () => {
    const { ctx } = await staff();
    signInAs(ctx);
    await beginMfaAction();

    expect(await confirmMfaAction(form({ code: "000000" }))).toEqual({ error: "wrong_code" });
    expect(await confirmMfaAction(form({}))).toEqual({ error: "missing_fields" });

    expect(await getMfaStatus()).toEqual({ enabled: false, recoveryCodesLeft: 0 });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("answers mfa_already_enabled when begun again once on", async () => {
    const { ctx } = await enrolled();
    signInAs(ctx);

    expect(await beginMfaAction()).toEqual({ error: "mfa_already_enabled" });
  });

  it("turns it off with the form's password and code", async () => {
    const { user, ctx, secret } = await enrolled();
    signInAs(ctx);

    expect(await disableMfaAction(form({ password: "NotThisOne26", code: appCode(secret) }))).toEqual({
      error: "wrong_password",
    });
    expect(await disableMfaAction(form({ password: PASSWORD, code: "000000" }))).toEqual({ error: "wrong_code" });
    expect(await disableMfaAction(form({ password: PASSWORD }))).toEqual({ error: "missing_fields" });
    expect((await getMfaStatus())?.enabled).toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();

    expect(await disableMfaAction(form({ password: PASSWORD, code: appCode(secret) }))).toEqual({ success: true });

    expect(await row(user.id)).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/dashboard", "layout");
  });

  it("makes new recovery codes for the form's code", async () => {
    const { user, ctx, secret, recoveryCodes: old } = await enrolled();
    signInAs(ctx);

    expect(await regenerateRecoveryCodesAction(form({ code: "000000" }))).toEqual({ error: "wrong_code" });
    const { recoveryCodes } = await regenerateRecoveryCodesAction(form({ code: appCode(secret) }));

    expect(recoveryCodes).toHaveLength(10);
    expect(recoveryCodes!.filter((code) => old.includes(code))).toEqual([]);
    expect(await mfaService.checkSignInCode(user.id, old[0])).toBe("failed");
  });

  it("acts on the signed-in user only: a colleague's stays as it was", async () => {
    const tenant = await createTestTenant();
    const laura = await enrolled("admin", tenant.id);
    const marcos = await enrolled("viewer", tenant.id);
    signInAs(marcos.ctx);

    // Laura's code and Marcos's password: not his second step.
    expect(await disableMfaAction(form({ password: PASSWORD, code: appCode(laura.secret) }))).toEqual({
      error: "wrong_code",
    });
    await disableMfaAction(form({ password: PASSWORD, code: appCode(marcos.secret) }));

    expect(await row(marcos.user.id)).toBeUndefined();
    expect((await row(laura.user.id))!.confirmedAt).toBeInstanceOf(Date);
  });

  it("never answers the secret again, nor a hash", async () => {
    const { user, ctx, secret } = await enrolled();
    signInAs(ctx);
    const stored = (await row(user.id))!;

    const answers = JSON.stringify([
      await getMfaStatus(),
      await beginMfaAction(),
      await confirmMfaAction(form({ code: appCode(secret) })),
      await disableMfaAction(form({ password: "NotThisOne26", code: appCode(secret) })),
      await regenerateRecoveryCodesAction(form({ code: "000000" })),
    ]);

    for (const secretThing of [secret, stored.secret, ...stored.recoveryCodes.flatMap((c) => [c.hash, c.salt])]) {
      expect(answers).not.toContain(secretThing);
    }
  });

  it.each([
    ["getMfaStatus", () => getMfaStatus()],
    ["beginMfaAction", () => beginMfaAction()],
    ["confirmMfaAction", () => confirmMfaAction(form({ code: "123456" }))],
    ["disableMfaAction", () => disableMfaAction(form({ password: PASSWORD, code: "123456" }))],
    ["regenerateRecoveryCodesAction", () => regenerateRecoveryCodesAction(form({ code: "123456" }))],
  ])("%s is the login page when signed out", async (_name, call) => {
    signInAs(null);

    await expect(call()).rejects.toEqual(TO_LOGIN);
  });

  it("lets an unexpected failure through, to the error page", async () => {
    const { ctx } = await staff();
    signInAs(ctx);
    const failing = vi.spyOn(mfaService, "beginEnrolment").mockRejectedValue(new Error("database down"));

    await expect(beginMfaAction()).rejects.toThrow("database down");
    failing.mockRestore();
  });
});

describe("removeUserMfaAction", () => {
  it("lets an admin remove a colleague's, ending their sessions, and the Users page shows it off", async () => {
    const tenant = await createTestTenant();
    const admin = await staff("admin", tenant.id);
    const marcos = await enrolled("viewer", tenant.id);
    signInAs(admin.ctx);
    expect((await getUsers()).find((u) => u.id === marcos.user.id)).toMatchObject({ mfaEnabled: true });

    expect(await removeUserMfaAction(marcos.user.id)).toEqual({});

    expect(await row(marcos.user.id)).toBeUndefined();
    expect((await db.query.users.findFirst({ where: eq(users.id, marcos.user.id) }))!.passwordChangedAt).toBeInstanceOf(Date);
    expect(revalidatePath).toHaveBeenCalledExactlyOnceWith("/dashboard/users");
    const list = await getUsers();
    expect(list.find((u) => u.id === marcos.user.id)).toMatchObject({ mfaEnabled: false });
    // On or off, and nothing else of it.
    expect(Object.keys(list[0]!).sort()).toEqual(["active", "createdAt", "email", "id", "mfaEnabled", "name", "phone", "role"]);
  });

  it.each(["manager", "viewer"] as const)("is forbidden to a %s", async (role) => {
    const tenant = await createTestTenant();
    const marcos = await enrolled("viewer", tenant.id);
    signInAs((await staff(role, tenant.id)).ctx);

    expect(await removeUserMfaAction(marcos.user.id)).toEqual({ error: "forbidden" });
    expect(await row(marcos.user.id)).toBeDefined();
  });

  it("answers not_found for another tenant's user, cannot_remove_own_mfa for the admin's own", async () => {
    const admin = await enrolled("admin");
    const stranger = await enrolled("viewer");
    signInAs(admin.ctx);

    expect(await removeUserMfaAction(stranger.user.id)).toEqual({ error: "not_found" });
    expect(await removeUserMfaAction(admin.user.id)).toEqual({ error: "cannot_remove_own_mfa" });

    expect(await row(stranger.user.id)).toBeDefined();
    expect(await row(admin.user.id)).toBeDefined();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("is the login page when signed out", async () => {
    signInAs(null);

    await expect(removeUserMfaAction("u")).rejects.toEqual(TO_LOGIN);
  });
});

describe("before the table is there (the portal deployed ahead of its SQL)", () => {
  it("offers no two-step verification in the settings, answers its actions with an error to show, and lists the users", async () => {
    const tenant = await createTestTenant();
    const admin = await staff("admin", tenant.id);
    const marcos = await enrolled("viewer", tenant.id);
    signInAs(admin.ctx);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await withoutTable("user_mfa", async () => {
      // The rail's settings: nothing to offer, and no failure of the layout.
      expect(await getMfaStatus()).toBeNull();
      // A dialog still open: an error it has a text for, not a crash.
      expect(await beginMfaAction()).toEqual({ error: "mfa_unavailable" });
      expect(await confirmMfaAction(form({ code: "123456" }))).toEqual({ error: "mfa_unavailable" });
      expect(await disableMfaAction(form({ password: PASSWORD, code: "123456" }))).toEqual({ error: "mfa_unavailable" });
      expect(await regenerateRecoveryCodesAction(form({ code: "123456" }))).toEqual({ error: "mfa_unavailable" });
      // Usuarios: the page lists everyone, with it off; removing one's says why not.
      expect((await getUsers()).map((u) => [u.id, u.mfaEnabled])).toEqual([
        [admin.user.id, false],
        [marcos.user.id, false],
      ]);
      expect(await removeUserMfaAction(marcos.user.id)).toEqual({ error: "mfa_unavailable" });
    });

    expect(revalidatePath).not.toHaveBeenCalled();
    expect(warn.mock.calls.map(([line]) => (JSON.parse(line as string) as { event: string }).event)).toEqual(
      Array.from({ length: 7 }, () => "mfa.table_missing"),
    );
    warn.mockRestore();
    // With the table: as ever.
    expect(await getMfaStatus()).toEqual({ enabled: false, recoveryCodesLeft: 0 });
    expect((await getUsers()).map((u) => u.mfaEnabled)).toEqual([false, true]);
  });

  it("has a text in both languages for that error, in the dialog and on Usuarios", () => {
    for (const [locale, messages] of Object.entries({ es, en })) {
      expect(messages.account.twoStep.errors.mfa_unavailable, locale).toMatch(/\S/);
      expect(messages.usersPage.errors.mfa_unavailable, locale).toMatch(/\S/);
    }
  });
});

