import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { signInAs } from "../../test/session";
import { createUser, getUsers, toggleUserActive, updateUserRole } from "./users";

vi.mock("../../auth", async () => (await import("../../test/session")).authMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Clients (mobile app users) must stay out of staff management.

async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const client = await createTestUser(tenant.id, { role: "client" });
  signInAs({ id: admin.id, tenantId: tenant.id, role: "admin" });
  return { tenant, admin, client };
}

async function reload(id: string) {
  return db.query.users.findFirst({ where: eq(users.id, id) });
}

beforeEach(async () => {
  await resetDatabase();
});

describe("staff user management", () => {
  it("lists staff but not clients", async () => {
    const { admin } = await setup();

    expect((await getUsers()).map((u) => u.id)).toEqual([admin.id]);
  });

  it("cannot promote a client", async () => {
    const { client } = await setup();

    await updateUserRole(client.id, "admin");

    expect((await reload(client.id))?.role).toBe("client");
  });

  it("rejects the client role for role changes", async () => {
    const { admin } = await setup();

    // Bypasses the type to simulate a crafted request.
    await expect(updateUserRole(admin.id, "client" as "viewer")).rejects.toThrow("Invalid role");
  });

  it("cannot deactivate a client from the users page", async () => {
    const { client } = await setup();

    await toggleUserActive(client.id, false);

    expect((await reload(client.id))?.active).toBe(true);
  });

  it("creates staff users", async () => {
    const { tenant } = await setup();

    expect(await createUser(null, staffForm({ role: "manager" }))).toEqual({ success: true });

    const created = await db.query.users.findFirst({ where: eq(users.email, "new@example.com") });
    expect(created).toMatchObject({ tenantId: tenant.id, role: "manager" });
  });

  it("rejects short passwords and duplicate emails", async () => {
    const { admin } = await setup();

    expect(await createUser(null, staffForm({ password: "short" }))).toEqual({
      error: "password_too_short",
    });
    expect(await createUser(null, staffForm({ email: admin.email }))).toEqual({
      error: "email_exists",
    });
  });

  it("returns no users to non-admins", async () => {
    const { tenant } = await setup();
    signInAs({ id: "someone", tenantId: tenant.id, role: "manager" });

    expect(await getUsers()).toEqual([]);
  });

  it("cannot create a client from the users page", async () => {
    await setup();

    expect(await createUser(null, staffForm({ role: "client" }))).toEqual({
      error: "missing_fields",
    });
  });
});

function staffForm(overrides: Record<string, string> = {}) {
  const data = new FormData();
  const fields = { email: "new@example.com", name: "New", password: "long-enough", role: "viewer" };
  for (const [key, value] of Object.entries({ ...fields, ...overrides })) data.set(key, value);
  return data;
}
