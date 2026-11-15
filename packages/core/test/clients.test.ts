import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clientProfiles, db, eq, pushTokens, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { clientAccountService, clientsService as svc, type Ctx } from "../src";

const validInput = {
  firstName: "Ana",
  surnames: "García López",
  email: "ana@example.com",
  password: "S3cret-pass",
  dateOfBirth: "1985-04-12",
  address: "Calle del Sol 5, Santander",
  phone: "+34 600 123 456",
};

async function findUser(email: string) {
  return db.query.users.findFirst({ where: eq(users.email, email) });
}

async function findProfile(userId: string) {
  return db.query.clientProfiles.findFirst({ where: eq(clientProfiles.userId, userId) });
}

async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  return { tenant, admin, ctx };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("createClient", () => {
  it("creates a client account with its profile", async () => {
    const { tenant, ctx } = await setup();

    const { id } = await svc.createClient(ctx, {
      ...validInput,
      firstName: "  Ana ",
      email: " ANA@Example.com",
    });

    const user = await findUser("ana@example.com");
    expect(user).toMatchObject({ id, tenantId: tenant.id, role: "client", name: "Ana García López" });
    expect(await bcrypt.compare(validInput.password, user!.passwordHash!)).toBe(true);
    expect(await findProfile(id)).toMatchObject({
      tenantId: tenant.id,
      firstName: "Ana",
      surnames: "García López",
      dateOfBirth: "1985-04-12",
      address: "Calle del Sol 5, Santander",
      phone: "+34 600 123 456",
    });
  });

  it("cuts overlong names and address at 200 characters", async () => {
    const { ctx } = await setup();

    const { id } = await svc.createClient(ctx, {
      ...validInput,
      firstName: "A".repeat(300),
      address: "C".repeat(300),
    });

    const profile = await findProfile(id);
    expect(profile?.firstName).toHaveLength(200);
    expect(profile?.address).toHaveLength(200);
  });

  it("stores empty optional fields as null", async () => {
    const { ctx } = await setup();

    const { id } = await svc.createClient(ctx, {
      ...validInput,
      dateOfBirth: "",
      address: "  ",
      phone: undefined,
    });

    expect(await findProfile(id)).toMatchObject({ dateOfBirth: null, address: null, phone: null });
  });

  it.each([
    [{ ...validInput, firstName: " " }, "missing_fields", 400],
    [{ ...validInput, surnames: "" }, "missing_fields", 400],
    [{ ...validInput, email: "" }, "missing_fields", 400],
    [{ ...validInput, password: "" }, "missing_fields", 400],
    [{ ...validInput, email: "not-an-email" }, "invalid_email", 400],
    [{ ...validInput, email: `${"a".repeat(200)}@example.com` }, "invalid_email", 400],
    [{ ...validInput, password: "Short1" }, "weak_password", 400],
    [{ ...validInput, password: "no-uppercase-1" }, "weak_password", 400],
    [{ ...validInput, password: "No-number-here" }, "weak_password", 400],
    [{ ...validInput, dateOfBirth: "12/04/1985" }, "invalid_date_of_birth", 400],
    [{ ...validInput, dateOfBirth: "1985-02-31" }, "invalid_date_of_birth", 400],
    [{ ...validInput, dateOfBirth: "2999-01-01" }, "invalid_date_of_birth", 400],
    [{ ...validInput, phone: "call me" }, "invalid_phone", 400],
  ])("rejects %j with %s", async (input, code, status) => {
    const { ctx } = await setup();

    await expect(svc.createClient(ctx, input)).rejects.toMatchObject({ code, status });
    expect(await findUser(validInput.email)).toBeUndefined();
  });

  it("rejects an email already used by a client in another tenant", async () => {
    const a = await setup();
    const b = await setup();
    await svc.createClient(a.ctx, validInput);

    await expect(svc.createClient(b.ctx, validInput)).rejects.toMatchObject({
      code: "email_exists",
      status: 409,
    });
  });

  it("rejects an email already used by staff in the same tenant", async () => {
    const { tenant, ctx } = await setup();
    await createTestUser(tenant.id, { email: validInput.email, role: "manager" });

    await expect(svc.createClient(ctx, validInput)).rejects.toMatchObject({
      code: "email_exists",
    });
  });

  it.each(["manager", "viewer"] as const)("is admin only (%s is forbidden)", async (role) => {
    const { ctx } = await setup();

    await expect(svc.createClient({ ...ctx, role }, validInput)).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
  });
});

describe("listClients", () => {
  it("lists the tenant's clients with their profiles", async () => {
    const { tenant, ctx } = await setup();
    const other = await setup();
    const { id } = await svc.createClient(ctx, validInput);
    await svc.createClient(other.ctx, { ...validInput, email: "other@example.com" });
    const legacy = await createTestUser(tenant.id, { role: "client", email: "legacy@example.com" });

    const clients = await svc.listClients(ctx);

    expect(clients).toEqual([
      {
        id,
        email: "ana@example.com",
        firstName: "Ana",
        surnames: "García López",
        dateOfBirth: "1985-04-12",
        address: "Calle del Sol 5, Santander",
        phone: "+34 600 123 456",
        active: true,
        createdAt: expect.any(String),
        deletionRequestedAt: null,
      },
      expect.objectContaining({ id: legacy.id, firstName: null, surnames: null }),
    ]);
  });

  it("says when a client asked in the app for their account to be deleted", async () => {
    const { tenant, ctx } = await setup();
    const { id } = await svc.createClient(ctx, validInput);

    const { deletionRequestedAt } = await clientAccountService.requestDeletion(tenant.id, id);

    expect(await svc.listClients(ctx)).toEqual([expect.objectContaining({ id, deletionRequestedAt })]);
  });

  it("does not list staff", async () => {
    const { ctx } = await setup();

    expect(await svc.listClients(ctx)).toEqual([]);
  });

  it("is admin only", async () => {
    const { ctx } = await setup();

    await expect(svc.listClients({ ...ctx, role: "manager" })).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("clearDeletionRequest", () => {
  async function asked() {
    const { tenant, ctx } = await setup();
    const { id } = await svc.createClient(ctx, validInput);
    await clientAccountService.requestDeletion(tenant.id, id);
    return { ctx, id };
  }
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });
  afterEach(() => warn.mockRestore());

  it("marks it handled, deleting and deactivating nothing", async () => {
    const { ctx, id } = await asked();

    expect(await svc.clearDeletionRequest(ctx, id)).toEqual({ id });

    expect(await findUser(validInput.email)).toMatchObject({ id, active: true, deletionRequestedAt: null });
    expect(await findProfile(id)).toBeDefined();
    const actions = warn.mock.calls.map((call: unknown[]) => JSON.parse(String(call[0])).action);
    expect(actions).toEqual(["requested", "cleared"]);
    // Nothing to clear: fine, and nothing logged.
    expect(await svc.clearDeletionRequest(ctx, id)).toEqual({ id });
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("does not touch staff or other tenants' clients", async () => {
    const { ctx, id } = await asked();
    const other = await setup();

    await expect(svc.clearDeletionRequest(other.ctx, id)).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(svc.clearDeletionRequest(ctx, ctx.userId)).rejects.toMatchObject({ code: "not_found" });
    expect((await findUser(validInput.email))!.deletionRequestedAt).toBeInstanceOf(Date);
  });

  it("is admin only", async () => {
    const { ctx, id } = await asked();

    await expect(svc.clearDeletionRequest({ ...ctx, role: "manager" }, id)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect((await findUser(validInput.email))!.deletionRequestedAt).toBeInstanceOf(Date);
  });
});

describe("setClientPassword", () => {
  it("replaces the client's password", async () => {
    const { ctx } = await setup();
    const { id } = await svc.createClient(ctx, validInput);
    await db.insert(pushTokens).values({ token: "ExpoPushToken[lost]", userId: id, tenantId: ctx.tenantId });

    await expect(svc.setClientPassword(ctx, id, { password: "Brand-new-pass1" })).resolves.toEqual({
      id,
    });

    const user = await findUser(validInput.email);
    expect(await bcrypt.compare("Brand-new-pass1", user!.passwordHash!)).toBe(true);
    // Signs the client out of the app on every phone, pushes included.
    expect(user!.passwordChangedAt).toBeInstanceOf(Date);
    expect(await db.select().from(pushTokens).where(eq(pushTokens.userId, id))).toEqual([]);
  });

  it.each(["Short1", "no-uppercase-1", "No-number-here", undefined])(
    "rejects the password %j: the policy is the same for everyone",
    async (password) => {
      const { ctx } = await setup();
      const { id } = await svc.createClient(ctx, validInput);

      await expect(svc.setClientPassword(ctx, id, { password })).rejects.toMatchObject({
        code: "weak_password",
        status: 400,
      });
      const user = await findUser(validInput.email);
      expect(await bcrypt.compare(validInput.password, user!.passwordHash!)).toBe(true);
    },
  );

  it("does not touch staff or other tenants' clients", async () => {
    const a = await setup();
    const b = await setup();
    const { id } = await svc.createClient(a.ctx, validInput);

    await expect(
      svc.setClientPassword(b.ctx, id, { password: "Brand-new-pass1" }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      svc.setClientPassword(a.ctx, a.admin.id, { password: "Brand-new-pass1" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("is admin only", async () => {
    const { ctx } = await setup();
    const { id } = await svc.createClient(ctx, validInput);

    await expect(
      svc.setClientPassword({ ...ctx, role: "viewer" }, id, { password: "Brand-new-pass1" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("input boundaries (schemas in src/inputs/clients.ts)", () => {
  it.each([
    // The order is the old one: what is missing, then the email, then the profile, then the password.
    ["missing_fields", { firstName: 5 }],
    ["missing_fields", { surnames: "  ", dateOfBirth: "tomorrow" }],
    ["missing_fields", { email: 7, phone: "x" }],
    ["missing_fields", { password: "", email: "bad" }],
    ["invalid_email", { email: "bad", dateOfBirth: "nope", password: 5 }],
    ["invalid_email", { email: `${"a".repeat(200)}@example.com` }],
    ["invalid_date_of_birth", { dateOfBirth: "2026-02-31", phone: "x" }],
    ["invalid_date_of_birth", { dateOfBirth: "2999-01-01" }],
    ["invalid_phone", { phone: "llámame", password: "weak" }],
    ["weak_password", { password: 12345678901 }],
    ["weak_password", { password: "weak" }],
  ])("createClient answers %s, as before, and writes nothing", async (code, overrides) => {
    const { ctx } = await setup();
    await expect(svc.createClient(ctx, { ...validInput, ...overrides })).rejects.toMatchObject({ code, status: 400 });
    expect(await db.select().from(clientProfiles)).toHaveLength(0);
  });

  it("reads form values leniently and ignores keys it doesn't take", async () => {
    const { tenant, ctx } = await setup();
    const { id } = await svc.createClient(ctx, {
      ...validInput,
      email: "  ANA@Example.com ",
      dateOfBirth: 19850412,
      address: 42,
      phone: "",
      tenantId: "other",
      role: "admin",
    });
    expect(await findUser("ana@example.com")).toMatchObject({ id, tenantId: tenant.id, role: "client" });
    expect(await findProfile(id)).toMatchObject({ dateOfBirth: null, address: null, phone: null });
  });

  it("setClientPassword: anything but a strong password is weak_password", async () => {
    const { tenant, ctx } = await setup();
    const client = await createTestUser(tenant.id, { role: "client" });
    for (const password of [undefined, null, 12345678901, "weak"]) {
      await expect(svc.setClientPassword(ctx, client.id, { password })).rejects.toMatchObject({ code: "weak_password", status: 400 });
    }
    expect((await findUser(client.email))?.passwordChangedAt).toBeNull();
  });
});
