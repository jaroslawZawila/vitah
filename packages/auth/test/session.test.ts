import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, tenants, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { createMobileToken } from "../src/mobile";
import { refreshSessionToken, SESSION_RECHECK_MS } from "../src/session";

// context.ts reads the portal session through NextAuth's `auth()`.
const auth = vi.fn();
vi.mock("../src/index", () => ({ auth }));
const { getRequestContext, getSessionContext } = await import("../src/context");

beforeEach(async () => {
  await resetDatabase();
  auth.mockReset();
});

async function staff(role: "admin" | "manager" | "viewer" = "admin") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  return { tenant, user, token: { sub: user.id, tenantId: tenant.id, role } };
}

describe("refreshSessionToken", () => {
  it("keeps an active user's session, noting when it checked", async () => {
    const { token } = await staff();

    expect(await refreshSessionToken(token, 1000)).toEqual({ ...token, checkedAt: 1000 });
  });

  it("trusts a check made within the last minute, then checks again", async () => {
    const { user, token } = await staff();
    await db.update(users).set({ active: false }).where(eq(users.id, user.id));
    const checked = { ...token, checkedAt: 1000 };

    expect(await refreshSessionToken(checked, 1000 + SESSION_RECHECK_MS - 1)).toBe(checked);
    expect(await refreshSessionToken(checked, 1000 + SESSION_RECHECK_MS)).toBeNull();
  });

  it("applies a changed role at once", async () => {
    const { user, token } = await staff("admin");
    await db.update(users).set({ role: "viewer" }).where(eq(users.id, user.id));

    expect(await refreshSessionToken(token)).toMatchObject({ role: "viewer" });
  });

  it("ends the session of a deactivated user", async () => {
    const { user, token } = await staff();
    await db.update(users).set({ active: false }).where(eq(users.id, user.id));

    expect(await refreshSessionToken(token)).toBeNull();
  });

  it("ends the session when the tenant is deactivated", async () => {
    const { tenant, token } = await staff();
    await db.update(tenants).set({ active: false }).where(eq(tenants.id, tenant.id));

    expect(await refreshSessionToken(token)).toBeNull();
  });

  it("ends a session whose user moved to another tenant or became a client", async () => {
    const { user, token } = await staff();
    const other = await createTestTenant();

    expect(await refreshSessionToken({ ...token, tenantId: other.id })).toBeNull();
    await db.update(users).set({ role: "client" }).where(eq(users.id, user.id));
    expect(await refreshSessionToken(token)).toBeNull();
  });

  it("ends a session without a user", async () => {
    expect(await refreshSessionToken({})).toBeNull();
  });
});

describe("getSessionContext", () => {
  it("builds the context from the session", async () => {
    const { user, tenant } = await staff("manager");
    auth.mockResolvedValue({ user: { id: user.id, tenantId: tenant.id, role: "manager" } });

    expect(await getSessionContext()).toEqual({
      tenantId: tenant.id,
      userId: user.id,
      role: "manager",
    });
  });

  it("is null without a session, or for a client", async () => {
    auth.mockResolvedValue(null);
    expect(await getSessionContext()).toBeNull();

    auth.mockResolvedValue({ user: { id: "u", tenantId: "t", role: "client" } });
    expect(await getSessionContext()).toBeNull();
  });
});

describe("getRequestContext with a Bearer token", () => {
  const bearer = (token: string) =>
    new Request("http://localhost/api/v1/projects", { headers: { authorization: `Bearer ${token}` } });

  async function tokenFor(user: { id: string; email: string; name: string | null }, tenantId: string, role: "admin" | "client") {
    return createMobileToken({ sub: user.id, email: user.email, name: user.name, role, tenantId });
  }

  it("uses the staff member's current role, not the token's", async () => {
    const { user, tenant } = await staff("viewer");
    const token = await tokenFor(user, tenant.id, "admin");

    expect(await getRequestContext(bearer(token))).toEqual({
      tenantId: tenant.id,
      userId: user.id,
      role: "viewer",
    });
  });

  it("rejects a deactivated staff member", async () => {
    const { user, tenant } = await staff();
    const token = await tokenFor(user, tenant.id, "admin");
    await db.update(users).set({ active: false }).where(eq(users.id, user.id));

    expect(await getRequestContext(bearer(token))).toBeNull();
  });

  it("rejects a client and an invalid token", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, { role: "client" });

    expect(await getRequestContext(bearer(await tokenFor(client, tenant.id, "client")))).toBeNull();
    expect(await getRequestContext(bearer("not-a-jwt"))).toBeNull();
    expect(auth).not.toHaveBeenCalled();
  });
});
