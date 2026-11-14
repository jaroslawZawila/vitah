import bcrypt from "bcryptjs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { createMobileToken } from "@repo/auth/mobile";
import { apiRequest, clientToken, staffToken } from "../../../../../test/api";
import { GET as me } from "../route";
import { POST } from "./route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

const CURRENT = "password123"; // createTestUser's, from before the policy
const NEXT = "CasaNordica26";

const hasPassword = async (id: string, password: string) =>
  bcrypt.compare(password, (await db.query.users.findFirst({ where: eq(users.id, id) }))!.passwordHash!);

const change = (token: string | null, body: unknown) => POST(apiRequest(token, { method: "POST", body }));

/** A token issued two minutes ago: its second is long past by the time the password changes. */
async function olderToken(tenantId: string, role: "admin" | "manager" | "viewer" = "viewer") {
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

describe("POST /api/v1/me/password", () => {
  it("changes the caller's own password, whatever their role, and revokes their tokens", async () => {
    const tenant = await createTestTenant();
    const { token, user } = await olderToken(tenant.id, "viewer");
    const colleague = await olderToken(tenant.id, "admin");

    const response = await change(token, { currentPassword: CURRENT, newPassword: NEXT });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true });
    expect(await hasPassword(user.id, NEXT)).toBe(true);
    // Signed out everywhere, this token included, once the change's grace is over
    // (requests in flight still pass, as with a portal session); nobody else is.
    expect((await me(apiRequest(token))).status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 31_000 });
    expect((await me(apiRequest(token))).status).toBe(401);
    expect((await me(apiRequest(colleague.token))).status).toBe(200);
    expect(await hasPassword(colleague.user.id, CURRENT)).toBe(true);
  });

  it.each([
    ["wrong_password", { currentPassword: "not-this-one", newPassword: NEXT }],
    ["weak_password", { currentPassword: CURRENT, newPassword: "Short1Aa" }],
    ["weak_password", { currentPassword: CURRENT, newPassword: "no-uppercase-1" }],
    ["weak_password", { currentPassword: CURRENT, newPassword: "No-number-here" }],
    ["missing_fields", { newPassword: NEXT }],
    ["invalid_body", [CURRENT, NEXT]],
  ])("answers 400 %s and changes nothing", async (error, body) => {
    const tenant = await createTestTenant();
    const { token, user } = await olderToken(tenant.id);

    const response = await change(token, body);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error });
    expect(await hasPassword(user.id, CURRENT)).toBe(true);
    expect((await me(apiRequest(token))).status).toBe(200);
  });

  it("refuses the same password again", async () => {
    const tenant = await createTestTenant();
    const user = await createTestUser(tenant.id, { role: "manager", password: NEXT });
    const token = await createMobileToken({
      sub: user.id,
      email: user.email,
      name: user.name,
      role: "manager",
      tenantId: tenant.id,
    });

    const response = await change(token, { currentPassword: NEXT, newPassword: NEXT });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "same_password" });
  });

  it("answers 429 after ten wrong current passwords, the right one included", async () => {
    const tenant = await createTestTenant();
    const { token, user } = await staffToken(tenant.id);
    for (let i = 0; i < 10; i++) {
      expect((await change(token, { currentPassword: `guess-${i}`, newPassword: NEXT })).status).toBe(400);
    }

    const response = await change(token, { currentPassword: CURRENT, newPassword: NEXT });

    expect(response.status).toBe(429);
    expect(await response.json()).toEqual({ error: "too_many_attempts" });
    expect(await hasPassword(user.id, CURRENT)).toBe(true);
  });

  it("needs a staff token: not a client's, and not none", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, { role: "client" });
    const body = { currentPassword: CURRENT, newPassword: NEXT };

    expect((await change(null, body)).status).toBe(401);
    expect((await change(await clientToken(tenant.id, client.id, client.email), body)).status).toBe(401);
    expect(await hasPassword(client.id, CURRENT)).toBe(true);
  });
});
