import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, pushTokens, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { clientAccountService as svc, isStrongPassword } from "../src";

async function setup() {
  const tenant = await createTestTenant();
  const client = await createTestUser(tenant.id, { role: "client", password: "vitah2026" });
  return { tenant, client };
}

const TOKEN = "ExponentPushToken[abc123]";
const { MAX_PUSH_TOKENS } = svc;

beforeEach(resetDatabase);

describe("isStrongPassword", () => {
  it.each([
    ["CasaNordica26", true],
    ["casanordica26", false], // no uppercase
    ["CasaNordica", false], // no number
    ["Casa2026", false], // too short
  ])("%s → %s", (password, strong) => {
    expect(isStrongPassword(password)).toBe(strong);
  });
});

describe("changePassword", () => {
  it("changes the password when the current one is right", async () => {
    const { tenant, client } = await setup();
    await svc.registerPushToken(tenant.id, client.id, { token: TOKEN });

    await svc.changePassword(tenant.id, client.id, {
      currentPassword: "vitah2026",
      newPassword: "CasaNordica26",
    });

    const row = await db.query.users.findFirst({ where: eq(users.id, client.id) });
    expect(await bcrypt.compare("CasaNordica26", row!.passwordHash!)).toBe(true);
    // Revokes the phones' existing tokens, and their pushes.
    expect(row!.passwordChangedAt).toBeInstanceOf(Date);
    expect(await db.select().from(pushTokens)).toEqual([]);
  });

  it("refuses more guesses after 10 wrong current passwords", async () => {
    const { tenant, client } = await setup();
    const attempt = (currentPassword: string) =>
      svc.changePassword(tenant.id, client.id, { currentPassword, newPassword: "CasaNordica26" });
    for (let i = 0; i < 10; i++) {
      await expect(attempt(`guess-${i}`)).rejects.toMatchObject({ code: "wrong_password" });
    }

    await expect(attempt("vitah2026")).rejects.toMatchObject({
      code: "too_many_attempts",
      status: 429,
    });
    const row = await db.query.users.findFirst({ where: eq(users.id, client.id) });
    expect(await bcrypt.compare("vitah2026", row!.passwordHash!)).toBe(true);
  });

  it.each([
    ["missing_fields", { currentPassword: "", newPassword: "CasaNordica26" }],
    ["missing_fields", { newPassword: "CasaNordica26" }],
    ["weak_password", { currentPassword: "vitah2026", newPassword: "short1A" }],
    ["wrong_password", { currentPassword: "nope", newPassword: "CasaNordica26" }],
  ])("rejects %s with 400, keeping the old password", async (code, input) => {
    const { tenant, client } = await setup();

    await expect(svc.changePassword(tenant.id, client.id, input)).rejects.toMatchObject({
      code,
      status: 400,
    });
    const row = await db.query.users.findFirst({ where: eq(users.id, client.id) });
    expect(await bcrypt.compare("vitah2026", row!.passwordHash!)).toBe(true);
  });

  it("only changes a client's own password", async () => {
    const { tenant } = await setup();
    const staff = await createTestUser(tenant.id, { role: "admin", password: "vitah2026" });
    const other = await setup();
    const input = { currentPassword: "vitah2026", newPassword: "CasaNordica26" };

    await expect(svc.changePassword(tenant.id, staff.id, input)).rejects.toMatchObject({
      code: "not_found",
    });
    await expect(svc.changePassword(tenant.id, other.client.id, input)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("settings", () => {
  it("starts with the defaults", async () => {
    const { tenant, client } = await setup();

    expect(await svc.getSettings(tenant.id, client.id)).toEqual({
      notifications: { progress: true, documents: true, messages: true },
      deletionRequestedAt: null,
    });
  });

  it("updates only what is sent", async () => {
    const { tenant, client } = await setup();

    await svc.updateSettings(tenant.id, client.id, { notifications: { messages: false } });
    const settings = await svc.updateSettings(tenant.id, client.id, {
      notifications: { documents: false },
    });

    expect(settings).toEqual({
      notifications: { progress: true, documents: false, messages: false },
      deletionRequestedAt: null,
    });
    expect(await svc.getSettings(tenant.id, client.id)).toEqual(settings);
  });

  it.each([
    [{}],
    [{ notifications: { progress: "yes" } }],
    [{ notifications: "off" }],
  ])("rejects invalid settings %j", async (input) => {
    const { tenant, client } = await setup();

    await expect(svc.updateSettings(tenant.id, client.id, input)).rejects.toMatchObject({
      code: "invalid_settings",
      status: 400,
    });
  });

  it("keeps each client's settings apart", async () => {
    const { tenant, client } = await setup();
    const other = await setup();
    const off = { notifications: { progress: false } };

    await svc.updateSettings(tenant.id, client.id, off);

    expect((await svc.getSettings(other.tenant.id, other.client.id)).notifications.progress).toBe(true);
    // Another tenant can't read or write this client's settings.
    expect((await svc.getSettings(other.tenant.id, client.id)).notifications.progress).toBe(true);
    await expect(svc.updateSettings(other.tenant.id, client.id, off)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("asking for the account to be deleted", () => {
  const requestedAt = async (userId: string) =>
    (await db.query.users.findFirst({ where: eq(users.id, userId) }))!.deletionRequestedAt;
  const logged = (spy: { mock: { calls: unknown[][] } }) =>
    spy.mock.calls
      .map(([line]) => JSON.parse(String(line)) as Record<string, unknown>)
      .filter((line) => line.event === "client.deletion_request");
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("records when the client asked, shows it in their settings, and keeps the first date", async () => {
    const { tenant, client } = await setup();

    const first = await svc.requestDeletion(tenant.id, client.id);

    expect(first.deletionRequestedAt).toEqual(expect.any(String));
    expect((await requestedAt(client.id))!.toISOString()).toBe(first.deletionRequestedAt);
    expect(await svc.getSettings(tenant.id, client.id)).toMatchObject({ deletionRequestedAt: first.deletionRequestedAt });
    expect(await svc.updateSettings(tenant.id, client.id, { notifications: { progress: false } })).toMatchObject({
      deletionRequestedAt: first.deletionRequestedAt,
    });

    // Asking again changes nothing, and logs nothing more.
    expect(await svc.requestDeletion(tenant.id, client.id)).toEqual(first);
    expect(logged(warn)).toEqual([
      expect.objectContaining({ level: "warn", action: "requested", tenantId: tenant.id, userId: client.id }),
    ]);
    // Only a request: the account stays as it was.
    expect(await db.query.users.findFirst({ where: eq(users.id, client.id) })).toMatchObject({ active: true });
  });

  it("logs ids only: no email, no name", async () => {
    const { tenant, client } = await setup();

    await svc.requestDeletion(tenant.id, client.id);

    const [line] = warn.mock.calls.map((call: unknown[]) => String(call[0]));
    expect(line).not.toContain(client.email);
    expect(Object.keys(JSON.parse(line!)).sort()).toEqual(["action", "event", "level", "tenantId", "time", "userId"]);
  });

  it("withdraws it; withdrawing none is fine", async () => {
    const { tenant, client } = await setup();
    await svc.requestDeletion(tenant.id, client.id);

    expect(await svc.withdrawDeletion(tenant.id, client.id)).toEqual({ deletionRequestedAt: null });
    expect(await requestedAt(client.id)).toBeNull();
    expect(await svc.withdrawDeletion(tenant.id, client.id)).toEqual({ deletionRequestedAt: null });
    expect(logged(warn).map((line) => line.action)).toEqual(["requested", "withdrawn"]);

    // Asked again later: a new date.
    expect((await svc.requestDeletion(tenant.id, client.id)).deletionRequestedAt).toEqual(expect.any(String));
  });

  it("touches only the caller's own account", async () => {
    const { tenant, client } = await setup();
    const neighbour = await createTestUser(tenant.id, { role: "client" });
    const other = await setup();
    await svc.requestDeletion(tenant.id, client.id);

    // Another client of the same builder, and of another one.
    await svc.withdrawDeletion(tenant.id, neighbour.id);
    await svc.withdrawDeletion(other.tenant.id, other.client.id);
    expect(await requestedAt(client.id)).not.toBeNull();
    expect(await requestedAt(neighbour.id)).toBeNull();

    // This client's id under another tenant is not theirs.
    await expect(svc.withdrawDeletion(other.tenant.id, client.id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(svc.requestDeletion(other.tenant.id, neighbour.id)).rejects.toMatchObject({ code: "not_found" });
    expect(await requestedAt(neighbour.id)).toBeNull();
    expect((await svc.getSettings(other.tenant.id, client.id)).deletionRequestedAt).toBeNull();
  });

  it("is refused to a deactivated client and to staff", async () => {
    const { tenant } = await setup();
    const gone = await createTestUser(tenant.id, { role: "client", active: false });
    const staff = await createTestUser(tenant.id, { role: "admin" });

    await expect(svc.requestDeletion(tenant.id, gone.id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(svc.requestDeletion(tenant.id, staff.id)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.withdrawDeletion(tenant.id, gone.id)).rejects.toMatchObject({ code: "not_found" });
    expect(await requestedAt(gone.id)).toBeNull();
    expect(await requestedAt(staff.id)).toBeNull();
    expect(logged(warn)).toEqual([]);
  });
});

describe("push tokens", () => {
  it("registers a phone once, moving it to whoever signed in last", async () => {
    const { tenant, client } = await setup();
    const next = await createTestUser(tenant.id, { role: "client" });

    await svc.registerPushToken(tenant.id, client.id, { token: TOKEN });
    await svc.registerPushToken(tenant.id, client.id, { token: TOKEN });
    await svc.registerPushToken(tenant.id, next.id, { token: TOKEN });

    expect(await db.select().from(pushTokens)).toEqual([
      expect.objectContaining({ token: TOKEN, userId: next.id, language: "es" }),
    ]);
  });

  it("keeps the phone's language, updating it on re-registration", async () => {
    const { tenant, client } = await setup();

    await svc.registerPushToken(tenant.id, client.id, { token: TOKEN, language: "en" });
    expect((await db.select().from(pushTokens))[0]?.language).toBe("en");

    await svc.registerPushToken(tenant.id, client.id, { token: TOKEN, language: "es" });
    expect((await db.select().from(pushTokens))[0]?.language).toBe("es");

    await expect(
      svc.registerPushToken(tenant.id, client.id, { token: TOKEN, language: "fr" }),
    ).rejects.toMatchObject({ code: "invalid_settings" });
  });

  it("rejects anything that isn't an Expo push token", async () => {
    const { tenant, client } = await setup();

    for (const token of ["hello", "ExponentPushToken[]", `ExponentPushToken[${"x".repeat(201)}]`]) {
      await expect(svc.registerPushToken(tenant.id, client.id, { token })).rejects.toMatchObject({
        code: "invalid_token",
        status: 400,
      });
    }
  });

  it("keeps a client's most recent phones only", async () => {
    const { tenant, client } = await setup();
    const other = await setup();
    await svc.registerPushToken(other.tenant.id, other.client.id, { token: "ExpoPushToken[other]" });
    for (let i = 0; i <= MAX_PUSH_TOKENS; i++) {
      await svc.registerPushToken(tenant.id, client.id, { token: `ExpoPushToken[phone-${i}]` });
    }

    const mine = await db.select().from(pushTokens).where(eq(pushTokens.userId, client.id));
    expect(mine).toHaveLength(MAX_PUSH_TOKENS);
    expect(mine.map((row) => row.token)).not.toContain("ExpoPushToken[phone-0]");
    expect(
      await db.select().from(pushTokens).where(eq(pushTokens.userId, other.client.id)),
    ).toHaveLength(1);
  });

  it("removes only the caller's own token", async () => {
    const { tenant, client } = await setup();
    const other = await setup();
    await svc.registerPushToken(tenant.id, client.id, { token: TOKEN });

    await svc.removePushToken(other.tenant.id, other.client.id, { token: TOKEN });
    expect(await db.select().from(pushTokens)).toHaveLength(1);

    await svc.removePushToken(tenant.id, client.id, { token: TOKEN });
    expect(await db.select().from(pushTokens)).toHaveLength(0);
  });
});

describe("input boundaries (schemas in src/inputs/clients.ts and accounts.ts)", () => {
  // Installed app builds can't be updated: each of these answers exactly as before.
  it.each([
    ["missing_fields", { currentPassword: 5, newPassword: "weak" }],
    ["missing_fields", { currentPassword: "vitah2026", newPassword: null }],
    ["missing_fields", { currentPassword: null }],
    ["weak_password", { currentPassword: "not-this-one", newPassword: "weak" }],
  ])("changePassword answers %s before looking at the current password", async (code, input) => {
    const { tenant, client } = await setup();
    await expect(svc.changePassword(tenant.id, client.id, input)).rejects.toMatchObject({ code, status: 400 });
  });

  it.each([
    [{ notifications: null }],
    [{ notifications: true }],
    [{ notifications: { documents: 0 } }],
    [{ notifications: { progress: true, messages: "false" } }],
  ])("updateSettings refuses %j as invalid_settings and changes nothing", async (input) => {
    const { tenant, client } = await setup();
    await expect(svc.updateSettings(tenant.id, client.id, input)).rejects.toMatchObject({ code: "invalid_settings", status: 400 });
    expect(await svc.getSettings(tenant.id, client.id)).toEqual(svc.DEFAULT_SETTINGS);
  });

  it("updateSettings takes an array as no change and ignores keys it doesn't know", async () => {
    const { tenant, client } = await setup();
    expect(await svc.updateSettings(tenant.id, client.id, { notifications: [] })).toEqual(svc.DEFAULT_SETTINGS);
    expect(
      await svc.updateSettings(tenant.id, client.id, { notifications: { progress: false, sound: true }, language: "en" }),
    ).toEqual({ notifications: { progress: false, documents: true, messages: true }, deletionRequestedAt: null });
  });

  it.each([
    ["invalid_token", { token: 5 }],
    ["invalid_token", { language: "fr" }],
    ["invalid_settings", { token: TOKEN, language: null }],
    ["invalid_settings", { token: TOKEN, language: "EN" }],
  ])("registerPushToken answers %s and stores nothing", async (code, input) => {
    const { tenant, client } = await setup();
    await expect(svc.registerPushToken(tenant.id, client.id, input)).rejects.toMatchObject({ code, status: 400 });
    expect(await db.select().from(pushTokens)).toHaveLength(0);
  });

  it("removePushToken: a token that isn't text is invalid_token", async () => {
    const { tenant, client } = await setup();
    await svc.registerPushToken(tenant.id, client.id, { token: TOKEN });
    for (const token of [undefined, null, 5]) {
      await expect(svc.removePushToken(tenant.id, client.id, { token })).rejects.toMatchObject({ code: "invalid_token" });
    }
    expect(await db.select().from(pushTokens)).toHaveLength(1);
  });

  it("readErrorReport: the known texts as sent, blank ones and others left out, fatal only when true", () => {
    expect(
      svc.readErrorReport({ message: " Boom ", stack: "  ", screen: 5, fatal: "yes", locale: "es-ES", token: "x" }),
    ).toEqual({ message: " Boom ", fatal: false, locale: "es-ES" });
    expect(svc.readErrorReport({ fatal: true })).toEqual({ fatal: true });
  });
});
