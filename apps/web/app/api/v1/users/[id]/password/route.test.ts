import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { apiRequest, routeParams, staffToken } from "../../../../../../test/api";
import { GET as me } from "../../../me/route";
import { PUT } from "./route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

const OLD = "password123"; // createTestUser's, from before the policy
const NEXT = "CasaNordica26";

const hasPassword = async (id: string, password: string) =>
  bcrypt.compare(password, (await db.query.users.findFirst({ where: eq(users.id, id) }))!.passwordHash!);

const reset = (token: string | null, id: string, body: unknown = { password: NEXT }) =>
  PUT(apiRequest(token, { method: "PUT", body }), routeParams({ id }));

/** A token issued two minutes ago: its second is long past by the time a password changes. */
async function olderToken(tenantId: string, role: "admin" | "manager" | "viewer") {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() - 120_000 });
  const issued = await staffToken(tenantId, role);
  vi.useRealTimers();
  return issued;
}

beforeEach(async () => {
  await resetDatabase();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("PUT /api/v1/users/:id/password", () => {
  it("lets an admin set a staff user's password, signing that user out and nobody else", async () => {
    const tenant = await createTestTenant();
    const admin = await olderToken(tenant.id, "admin");
    const viewer = await olderToken(tenant.id, "viewer");

    const response = await reset(admin.token, viewer.user.id);

    expect(response.status).toBe(200);
    // The id only: the password is never sent back.
    expect(await response.json()).toEqual({ id: viewer.user.id });
    expect(await hasPassword(viewer.user.id, NEXT)).toBe(true);
    // Their token from before passes for the change's grace (as a portal session does), then it is refused.
    expect((await me(apiRequest(viewer.token))).status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 31_000 });
    expect((await me(apiRequest(viewer.token))).status).toBe(401);
    expect((await me(apiRequest(admin.token))).status).toBe(200);
  });

  it.each(["manager", "viewer"] as const)("is forbidden to a %s", async (role) => {
    const tenant = await createTestTenant();
    const { token } = await staffToken(tenant.id, role);
    const target = await createTestUser(tenant.id, { role: "viewer" });

    const response = await reset(token, target.id);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(await hasPassword(target.id, OLD)).toBe(true);
  });

  it("answers 404 for a user of another tenant, and for a client", async () => {
    const tenant = await createTestTenant();
    const { token } = await staffToken(tenant.id, "admin");
    const other = await createTestTenant();
    const stranger = await createTestUser(other.id, { role: "viewer" });
    const client = await createTestUser(tenant.id, { role: "client" });

    for (const id of [stranger.id, client.id, "no-such-user"]) {
      const response = await reset(token, id);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect(await hasPassword(stranger.id, OLD)).toBe(true);
    expect(await hasPassword(client.id, OLD)).toBe(true);
  });

  it("is not for the admin's own password", async () => {
    const tenant = await createTestTenant();
    const { token, user } = await staffToken(tenant.id, "admin");

    const response = await reset(token, user.id);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "cannot_reset_own_password" });
    expect(await hasPassword(user.id, OLD)).toBe(true);
  });

  it.each([{ password: "Short1Aa" }, { password: "no-uppercase-1" }, { password: "No-number-here" }, {}])(
    "answers 400 weak_password for %j",
    async (body) => {
      const tenant = await createTestTenant();
      const { token } = await staffToken(tenant.id, "admin");
      const target = await createTestUser(tenant.id, { role: "viewer" });

      const response = await reset(token, target.id, body);

      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "weak_password" });
      expect(await hasPassword(target.id, OLD)).toBe(true);
    },
  );

  it("needs a staff token", async () => {
    const tenant = await createTestTenant();
    const target = await createTestUser(tenant.id, { role: "viewer" });

    expect((await reset(null, target.id)).status).toBe(401);
  });
});
