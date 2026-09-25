import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { db, eq, pushTokens, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { clientAccountService as svc, isStrongPassword } from "../src";

async function setup() {
  const tenant = await createTestTenant();
  const client = await createTestUser(tenant.id, { role: "client", password: "vitah2026" });
  return { tenant, client };
}

const TOKEN = "ExponentPushToken[abc123]";

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

    await svc.changePassword(tenant.id, client.id, {
      currentPassword: "vitah2026",
      newPassword: "CasaNordica26",
    });

    const row = await db.query.users.findFirst({ where: eq(users.id, client.id) });
    expect(await bcrypt.compare("CasaNordica26", row!.passwordHash!)).toBe(true);
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

    await expect(
      svc.registerPushToken(tenant.id, client.id, { token: "hello" }),
    ).rejects.toMatchObject({ code: "invalid_token", status: 400 });
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
