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
        password: "long-enough",
        role: "client",
      }),
    ).rejects.toMatchObject({ code: "missing_fields" });
  });

  it("creates staff users with a hashed password", async () => {
    const { tenant, ctx } = await setup();

    await svc.createUser(ctx, {
      email: "new@example.com",
      name: "New",
      password: "long-enough",
      role: "manager",
    });

    const created = await db.query.users.findFirst({ where: eq(users.email, "new@example.com") });
    expect(created).toMatchObject({ tenantId: tenant.id, role: "manager" });
    expect(created?.passwordHash).toMatch(/^\$2[aby]\$/);
  });
});

describe("createUser emails", () => {
  const input = { name: "New", password: "long-enough", role: "manager" };

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
