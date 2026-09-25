import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { clientProfiles, db, eq, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { clientsService as svc, type Ctx } from "../src";

const validInput = {
  firstName: "Ana",
  surnames: "García López",
  email: "ana@example.com",
  password: "s3cret-pass",
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
    [{ ...validInput, password: "short" }, "password_too_short", 400],
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
      },
      expect.objectContaining({ id: legacy.id, firstName: null, surnames: null }),
    ]);
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

describe("setClientPassword", () => {
  it("replaces the client's password", async () => {
    const { ctx } = await setup();
    const { id } = await svc.createClient(ctx, validInput);

    await expect(svc.setClientPassword(ctx, id, { password: "brand-new-pass" })).resolves.toEqual({
      id,
    });

    const user = await findUser(validInput.email);
    expect(await bcrypt.compare("brand-new-pass", user!.passwordHash!)).toBe(true);
  });

  it("rejects a short password", async () => {
    const { ctx } = await setup();
    const { id } = await svc.createClient(ctx, validInput);

    await expect(svc.setClientPassword(ctx, id, { password: "short" })).rejects.toMatchObject({
      code: "password_too_short",
    });
  });

  it("does not touch staff or other tenants' clients", async () => {
    const a = await setup();
    const b = await setup();
    const { id } = await svc.createClient(a.ctx, validInput);

    await expect(
      svc.setClientPassword(b.ctx, id, { password: "brand-new-pass" }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      svc.setClientPassword(a.ctx, a.admin.id, { password: "brand-new-pass" }),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("is admin only", async () => {
    const { ctx } = await setup();
    const { id } = await svc.createClient(ctx, validInput);

    await expect(
      svc.setClientPassword({ ...ctx, role: "viewer" }, id, { password: "brand-new-pass" }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
