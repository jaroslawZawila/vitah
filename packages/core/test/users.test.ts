import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { db, eq, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { usersService as svc, type Ctx } from "../src";

// Clients (mobile app users) must stay out of staff management.

async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const client = await createTestUser(tenant.id, { role: "client" });
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  return { tenant, admin, client, ctx };
}

async function reload(id: string) {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

beforeEach(async () => {
  await resetDatabase();
});

describe("usersService and clients", () => {
  it("lists staff but not clients", async () => {
    const { admin, ctx } = await setup();

    expect((await svc.listUsers(ctx)).map((u) => u.id)).toEqual([admin.id]);
  });

  it("cannot promote a client", async () => {
    const { client, ctx } = await setup();

    await expect(svc.updateUser(ctx, client.id, { role: "admin" })).rejects.toMatchObject({
      code: "not_found",
    });
    expect((await reload(client.id))?.role).toBe("client");
  });

  it("cannot deactivate a client", async () => {
    const { client, ctx } = await setup();

    await expect(svc.updateUser(ctx, client.id, { active: false })).rejects.toMatchObject({
      code: "not_found",
    });
    expect((await reload(client.id))?.active).toBe(true);
  });

  it("rejects the client role", async () => {
    const { tenant, ctx } = await setup();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });

    await expect(svc.updateUser(ctx, viewer.id, { role: "client" })).rejects.toMatchObject({
      code: "invalid_role",
    });
    await expect(
      svc.createUser(ctx, {
        email: "new@example.com",
        name: "New",
        password: "Long-enough1",
        role: "client",
      }),
    ).rejects.toMatchObject({ code: "missing_fields" });
  });

  it("creates staff users with a hashed password", async () => {
    const { tenant, ctx } = await setup();

    await svc.createUser(ctx, {
      email: "new@example.com",
      name: "New",
      password: "Long-enough1",
      role: "manager",
    });

    const created = await db.query.users.findFirst({ where: eq(users.email, "new@example.com") });
    expect(created).toMatchObject({ tenantId: tenant.id, role: "manager" });
    expect(created?.passwordHash).toMatch(/^\$2[aby]\$/);
  });
});

describe("createUser emails", () => {
  const input = { name: "New", password: "Long-enough1", role: "manager" };

  it("stores the email lower-cased and trimmed", async () => {
    const { ctx } = await setup();

    const { id } = await svc.createUser(ctx, { ...input, email: "  New.Person@Example.COM " });

    expect((await reload(id))?.email).toBe("new.person@example.com");
  });

  it("rejects an email another tenant's staff already use, in any case", async () => {
    const { ctx } = await setup();
    const other = await createTestTenant();
    await createTestUser(other.id, { email: "Taken@Example.com", role: "viewer" });

    await expect(svc.createUser(ctx, { ...input, email: "taken@example.com" })).rejects.toMatchObject({
      code: "email_exists",
      status: 400,
    });
  });

  it("allows an email a client uses in another tenant", async () => {
    const { ctx } = await setup();
    const other = await createTestTenant();
    await createTestUser(other.id, { email: "ana@example.com", role: "client" });

    await expect(svc.createUser(ctx, { ...input, email: "ana@example.com" })).resolves.toEqual({
      id: expect.any(String),
    });
  });

  it("rejects an invalid or overlong email or name", async () => {
    const { ctx } = await setup();

    await expect(svc.createUser(ctx, { ...input, email: "not-an-email" })).rejects.toMatchObject({
      code: "invalid_email",
    });
    await expect(
      svc.createUser(ctx, { ...input, email: `${"a".repeat(200)}@example.com` }),
    ).rejects.toMatchObject({ code: "too_long" });
    await expect(
      svc.createUser(ctx, { ...input, email: "ok@example.com", name: "n".repeat(201) }),
    ).rejects.toMatchObject({ code: "too_long" });
  });
});

describe("usersService: the caller's own settings", () => {
  it("lets any staff user change their own language, and only theirs", async () => {
    const { tenant, admin } = await setup();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    const ctx: Ctx = { tenantId: tenant.id, userId: viewer.id, role: "viewer" };

    // Not chosen yet: the portal follows their browser.
    expect(await svc.getMe(ctx)).toMatchObject({ id: viewer.id, role: "viewer", language: null });
    expect(await svc.updateMe(ctx, { language: "en" })).toMatchObject({ id: viewer.id, language: "en" });
    expect((await reload(viewer.id))?.language).toBe("en");
    expect((await reload(admin.id))?.language).toBeNull();
    // Each setting is optional; null goes back to the browser's.
    expect(await svc.updateMe(ctx, {})).toMatchObject({ language: "en" });
    expect(await svc.updateMe(ctx, { language: null })).toMatchObject({ language: null });
  });

  it("refuses a language the portal doesn't have", async () => {
    const { admin, ctx } = await setup();

    await expect(svc.updateMe(ctx, { language: "fr" })).rejects.toMatchObject({ code: "invalid_language" });
    expect((await reload(admin.id))?.language).toBeNull();
  });

  it("is not for a deactivated user", async () => {
    const { tenant } = await setup();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    await db.update(users).set({ active: false }).where(eq(users.id, viewer.id));
    const ctx: Ctx = { tenantId: tenant.id, userId: viewer.id, role: "viewer" };

    await expect(svc.getMe(ctx)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.updateMe(ctx, { language: "en" })).rejects.toMatchObject({ code: "not_found" });
  });

  it("finds no one for a context of another tenant", async () => {
    const { admin } = await setup();
    const other = await createTestTenant();
    const ctx: Ctx = { tenantId: other.id, userId: admin.id, role: "admin" };

    await expect(svc.getMe(ctx)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.updateMe(ctx, { language: "en" })).rejects.toMatchObject({ code: "not_found" });
    expect((await reload(admin.id))?.language).toBeNull();
  });
});

describe("the password policy on staff accounts", () => {
  const input = { email: "new@example.com", name: "New", role: "manager" };

  it.each([
    ["Short1Aa", "under 10 characters"],
    ["no-uppercase-1", "no uppercase letter"],
    ["No-number-here", "no number"],
  ])("refuses to create a user with the password %j (%s)", async (password) => {
    const { ctx } = await setup();

    await expect(svc.createUser(ctx, { ...input, password })).rejects.toMatchObject({
      code: "weak_password",
      status: 400,
    });
    expect(await db.query.users.findFirst({ where: eq(users.email, input.email) })).toBeUndefined();
  });

  it("applies to new passwords only: an account with an older, shorter one is untouched", async () => {
    const { tenant, ctx } = await setup();
    // Set when the minimum was 8 characters.
    const old = await createTestUser(tenant.id, { role: "viewer", password: "old-pass" });

    await svc.updateUser(ctx, old.id, { role: "manager" });

    const row = await reload(old.id);
    expect(await bcrypt.compare("old-pass", row!.passwordHash!)).toBe(true);
    expect(row!.passwordChangedAt).toBeNull();
  });
});

describe("changeMyPassword", () => {
  const CURRENT = "old-pass"; // from before the policy: still the one to enter
  const NEXT = "CasaNordica26";

  async function viewer() {
    const { tenant, admin } = await setup();
    const user = await createTestUser(tenant.id, { role: "viewer", password: CURRENT });
    const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role: "viewer" };
    return { tenant, admin, user, ctx };
  }

  it("changes the caller's own password and notes when", async () => {
    const { admin, user, ctx } = await viewer();
    const before = Date.now();

    expect(await svc.changeMyPassword(ctx, { currentPassword: CURRENT, newPassword: NEXT })).toEqual({
      success: true,
    });

    const row = await reload(user.id);
    expect(await bcrypt.compare(NEXT, row!.passwordHash!)).toBe(true);
    expect(await bcrypt.compare(CURRENT, row!.passwordHash!)).toBe(false);
    // What revokes the sessions and tokens issued before it.
    expect(row!.passwordChangedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect((await reload(admin.id))?.passwordChangedAt).toBeNull();
  });

  it.each([
    ["missing_fields", { currentPassword: "", newPassword: NEXT }],
    ["missing_fields", { newPassword: NEXT }],
    ["missing_fields", { currentPassword: CURRENT }],
    ["missing_fields", { currentPassword: CURRENT, newPassword: 12345678901 }],
    ["wrong_password", { currentPassword: "not-this-one", newPassword: NEXT }],
    ["weak_password", { currentPassword: CURRENT, newPassword: "Short1Aa" }],
    ["weak_password", { currentPassword: CURRENT, newPassword: "no-uppercase-1" }],
    ["weak_password", { currentPassword: CURRENT, newPassword: "No-number-here" }],
  ])("rejects %s with 400, keeping the password and the sessions", async (code, input) => {
    const { user, ctx } = await viewer();

    await expect(svc.changeMyPassword(ctx, input)).rejects.toMatchObject({ code, status: 400 });

    const row = await reload(user.id);
    expect(await bcrypt.compare(CURRENT, row!.passwordHash!)).toBe(true);
    expect(row!.passwordChangedAt).toBeNull();
  });

  it("refuses the same password again", async () => {
    const { tenant } = await setup();
    const user = await createTestUser(tenant.id, { role: "manager", password: NEXT });
    const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role: "manager" };

    await expect(
      svc.changeMyPassword(ctx, { currentPassword: NEXT, newPassword: NEXT }),
    ).rejects.toMatchObject({ code: "same_password", status: 400 });
    expect((await reload(user.id))?.passwordChangedAt).toBeNull();
  });

  it("refuses more guesses after 10 wrong current passwords, the right one too", async () => {
    const { user, ctx } = await viewer();
    for (let i = 0; i < 10; i++) {
      await expect(
        svc.changeMyPassword(ctx, { currentPassword: `guess-${i}`, newPassword: NEXT }),
      ).rejects.toMatchObject({ code: "wrong_password" });
    }

    await expect(
      svc.changeMyPassword(ctx, { currentPassword: CURRENT, newPassword: NEXT }),
    ).rejects.toMatchObject({ code: "too_many_attempts", status: 429 });
    expect(await bcrypt.compare(CURRENT, (await reload(user.id))!.passwordHash!)).toBe(true);
  });

  it("is for the caller only: not a deactivated user, a client or another tenant's context", async () => {
    const { tenant, user, ctx } = await viewer();
    const input = { currentPassword: CURRENT, newPassword: NEXT };
    const client = await createTestUser(tenant.id, { role: "client", password: CURRENT });
    const other = await createTestTenant();

    await expect(
      svc.changeMyPassword({ ...ctx, userId: client.id }, input),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      svc.changeMyPassword({ ...ctx, tenantId: other.id }, input),
    ).rejects.toMatchObject({ code: "not_found" });
    await db.update(users).set({ active: false }).where(eq(users.id, user.id));
    await expect(svc.changeMyPassword(ctx, input)).rejects.toMatchObject({ code: "not_found" });

    expect(await bcrypt.compare(CURRENT, (await reload(user.id))!.passwordHash!)).toBe(true);
    expect(await bcrypt.compare(CURRENT, (await reload(client.id))!.passwordHash!)).toBe(true);
  });
});

describe("resetUserPassword", () => {
  const NEXT = "CasaNordica26";

  it("sets another staff user's password and revokes their sessions", async () => {
    const { tenant, admin, ctx } = await setup();
    const viewer = await createTestUser(tenant.id, { role: "viewer", password: "old-pass" });
    const before = Date.now();

    expect(await svc.resetUserPassword(ctx, viewer.id, { password: NEXT })).toEqual({ id: viewer.id });

    const row = await reload(viewer.id);
    expect(await bcrypt.compare(NEXT, row!.passwordHash!)).toBe(true);
    expect(row!.passwordChangedAt!.getTime()).toBeGreaterThanOrEqual(before);
    // The admin's own sessions carry on.
    expect((await reload(admin.id))?.passwordChangedAt).toBeNull();
  });

  it("works on a deactivated user too (before letting them back in)", async () => {
    const { tenant, ctx } = await setup();
    const viewer = await createTestUser(tenant.id, { role: "viewer", active: false });

    await expect(svc.resetUserPassword(ctx, viewer.id, { password: NEXT })).resolves.toEqual({ id: viewer.id });
  });

  it.each(["manager", "viewer"] as const)("is admin only (%s is forbidden)", async (role) => {
    const { tenant, ctx } = await setup();
    const viewer = await createTestUser(tenant.id, { role: "viewer", password: "old-pass" });

    await expect(
      svc.resetUserPassword({ ...ctx, role }, viewer.id, { password: NEXT }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(await bcrypt.compare("old-pass", (await reload(viewer.id))!.passwordHash!)).toBe(true);
  });

  it("finds no one in another tenant, and no client", async () => {
    const { client, ctx } = await setup();
    const other = await setup();

    await expect(
      svc.resetUserPassword(ctx, other.admin.id, { password: NEXT }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      svc.resetUserPassword(ctx, client.id, { password: NEXT }),
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await reload(other.admin.id))?.passwordChangedAt).toBeNull();
    expect((await reload(client.id))?.passwordChangedAt).toBeNull();
  });

  it("is not for the admin's own password", async () => {
    const { admin, ctx } = await setup();

    await expect(svc.resetUserPassword(ctx, admin.id, { password: NEXT })).rejects.toMatchObject({
      code: "cannot_reset_own_password",
      status: 400,
    });
    expect((await reload(admin.id))?.passwordChangedAt).toBeNull();
  });

  it.each(["Short1Aa", "no-uppercase-1", "No-number-here", undefined, 1234567890])(
    "refuses the password %j",
    async (password) => {
      const { tenant, ctx } = await setup();
      const viewer = await createTestUser(tenant.id, { role: "viewer", password: "old-pass" });

      await expect(svc.resetUserPassword(ctx, viewer.id, { password })).rejects.toMatchObject({
        code: "weak_password",
        status: 400,
      });
      expect(await bcrypt.compare("old-pass", (await reload(viewer.id))!.passwordHash!)).toBe(true);
    },
  );
});

describe("deactivating a user", () => {
  it("revokes their sessions for good: activating them again doesn't bring them back", async () => {
    const { tenant, ctx } = await setup();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    const before = Date.now();

    await svc.updateUser(ctx, viewer.id, { active: false });
    const revokedAt = (await reload(viewer.id))!.passwordChangedAt!;
    expect(revokedAt.getTime()).toBeGreaterThanOrEqual(before);

    await svc.updateUser(ctx, viewer.id, { active: true });
    expect((await reload(viewer.id))!.passwordChangedAt).toEqual(revokedAt);
  });

  it("leaves the sessions alone on a role change", async () => {
    const { tenant, ctx } = await setup();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });

    await svc.updateUser(ctx, viewer.id, { role: "manager" });

    expect((await reload(viewer.id))!.passwordChangedAt).toBeNull();
  });
});

describe("input boundaries (schemas in src/inputs/accounts.ts)", () => {
  const VALID = { email: "new@example.com", name: "New", password: "Long-enough1", role: "manager" };

  it.each([
    // The order of the checks is the old one: a long email or name, then what is missing, the email, the password.
    ["too_long", { ...VALID, email: `${"a".repeat(200)}@x.es`, password: 5 }],
    ["too_long", { ...VALID, name: "n".repeat(201), role: "client" }],
    ["missing_fields", { ...VALID, email: 5 }],
    ["missing_fields", { ...VALID, name: "  " }],
    ["missing_fields", { ...VALID, password: "" }],
    ["missing_fields", { ...VALID, password: 12345678901 }],
    ["missing_fields", { ...VALID, role: "owner", email: "not-an-email" }],
    ["invalid_email", { ...VALID, email: "not-an-email", password: "weak" }],
    ["weak_password", { ...VALID, password: "weak" }],
  ])("createUser answers %s, as before, and writes nothing", async (code, input) => {
    const { ctx } = await setup();
    await expect(svc.createUser(ctx, input)).rejects.toMatchObject({ code, status: 400 });
    expect(await db.select().from(users)).toHaveLength(2);
  });

  it("ignores keys it doesn't take; a password is never trimmed", async () => {
    const { tenant, ctx } = await setup();
    const { id } = await svc.createUser(ctx, { ...VALID, password: " Long-enough1 ", tenantId: "other", active: false, extra: 1 });
    const row = await reload(id);
    expect(row).toMatchObject({ tenantId: tenant.id, active: true, role: "manager" });
    expect(await bcrypt.compare(" Long-enough1 ", row!.passwordHash!)).toBe(true);
  });

  it.each([
    ["invalid_role", { role: "client" }],
    ["invalid_role", { role: null }],
    ["invalid_active", { active: "false" }],
    ["invalid_active", { active: null }],
  ])("updateUser answers %s and changes nothing", async (code, input) => {
    const { tenant, ctx } = await setup();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    await expect(svc.updateUser(ctx, viewer.id, input)).rejects.toMatchObject({ code, status: 400 });
    expect(await reload(viewer.id)).toMatchObject({ role: "viewer", active: true });
  });

  it("updateUser: a key sent as undefined is not sent; extra keys are ignored", async () => {
    const { tenant, ctx } = await setup();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    await svc.updateUser(ctx, viewer.id, { role: undefined, active: undefined, tenantId: "other", email: "x@y.es" });
    expect(await reload(viewer.id)).toMatchObject({ role: "viewer", active: true, tenantId: tenant.id, email: viewer.email });
  });

  it("updateMe: a language or null; anything else is invalid_language", async () => {
    const { ctx } = await setup();
    for (const language of [5, "", "ES", ["es"]]) {
      await expect(svc.updateMe(ctx, { language })).rejects.toMatchObject({ code: "invalid_language", status: 400 });
    }
    expect(await svc.updateMe(ctx, { language: "en", role: "viewer" })).toMatchObject({ language: "en", role: "admin" });
    expect(await svc.updateMe(ctx, { language: null })).toMatchObject({ language: null });
  });

  it("resetUserPassword: refuses its own before the password, then any weak one", async () => {
    const { tenant, admin, ctx } = await setup();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    await expect(svc.resetUserPassword(ctx, admin.id, { password: 5 })).rejects.toMatchObject({ code: "cannot_reset_own_password" });
    for (const password of [undefined, null, 12345678901, "weak"]) {
      await expect(svc.resetUserPassword(ctx, viewer.id, { password })).rejects.toMatchObject({ code: "weak_password", status: 400 });
    }
    expect((await reload(viewer.id))?.passwordChangedAt).toBeNull();
  });
});
