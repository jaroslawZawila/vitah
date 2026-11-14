import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, userMfa, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { mfaService } from "@repo/core";
import { base32Decode, totp } from "@repo/core/totp";
import { apiRequest, clientToken, routeParams, staffToken } from "../../../../../../test/api";
import { GET as me } from "../../../me/route";
import { DELETE } from "./route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

const remove = (token: string | null, id: string) => DELETE(apiRequest(token, { method: "DELETE" }), routeParams({ id }));

/** A staff token issued two minutes ago, whose user has two-step verification on. */
async function enrolledToken(tenantId: string, role: "admin" | "manager" | "viewer") {
  vi.useFakeTimers({ toFake: ["Date"], now: Date.now() - 120_000 });
  const issued = await staffToken(tenantId, role);
  const ctx = { tenantId, userId: issued.user.id, role };
  const { secret } = await mfaService.beginEnrolment(ctx);
  await mfaService.confirmEnrolment(ctx, { code: totp(base32Decode(secret)!, Date.now()) });
  vi.useRealTimers();
  return issued;
}

const row = (userId: string) => db.query.userMfa.findFirst({ where: eq(userMfa.userId, userId) });
const changedAt = async (id: string) => (await db.query.users.findFirst({ where: eq(users.id, id) }))!.passwordChangedAt;

beforeEach(async () => {
  await resetDatabase();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("DELETE /api/v1/users/:id/mfa", () => {
  it("lets an admin remove a staff user's two-step verification, signing that user out and nobody else", async () => {
    const tenant = await createTestTenant();
    const admin = await enrolledToken(tenant.id, "admin");
    const viewer = await enrolledToken(tenant.id, "viewer");

    const response = await remove(admin.token, viewer.user.id);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ id: viewer.user.id });
    expect(await row(viewer.user.id)).toBeUndefined();
    expect(await row(admin.user.id)).toBeDefined();
    // Their token from before passes for the grace (as after a password reset), then it is refused.
    expect((await me(apiRequest(viewer.token))).status).toBe(200);
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + 31_000 });
    expect((await me(apiRequest(viewer.token))).status).toBe(401);
    expect((await me(apiRequest(admin.token))).status).toBe(200);
  });

  it.each(["manager", "viewer"] as const)("is forbidden to a %s", async (role) => {
    const tenant = await createTestTenant();
    const { token } = await staffToken(tenant.id, role);
    const target = await enrolledToken(tenant.id, "viewer");

    const response = await remove(token, target.user.id);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden" });
    expect(await row(target.user.id)).toBeDefined();
    expect(await changedAt(target.user.id)).toBeNull();
  });

  it("answers 404 for a user of another tenant, for a client and for nobody", async () => {
    const tenant = await createTestTenant();
    const { token } = await staffToken(tenant.id, "admin");
    const stranger = await enrolledToken((await createTestTenant()).id, "viewer");
    const client = await createTestUser(tenant.id, { role: "client" });

    for (const id of [stranger.user.id, client.id, "no-such-user"]) {
      const response = await remove(token, id);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
    expect(await row(stranger.user.id)).toBeDefined();
    expect(await changedAt(stranger.user.id)).toBeNull();
  });

  it("is not for the admin's own", async () => {
    const tenant = await createTestTenant();
    const admin = await enrolledToken(tenant.id, "admin");

    const response = await remove(admin.token, admin.user.id);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "cannot_remove_own_mfa" });
    expect(await row(admin.user.id)).toBeDefined();
  });

  it("answers 400 mfa_not_enabled for a user without it, signing nobody out", async () => {
    const tenant = await createTestTenant();
    const { token } = await staffToken(tenant.id, "admin");
    const plain = await staffToken(tenant.id, "viewer");

    const response = await remove(token, plain.user.id);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "mfa_not_enabled" });
    expect(await changedAt(plain.user.id)).toBeNull();
  });

  it("needs a staff token", async () => {
    const tenant = await createTestTenant();
    const target = await enrolledToken(tenant.id, "viewer");
    const client = await createTestUser(tenant.id, { role: "client" });

    expect((await remove(null, target.user.id)).status).toBe(401);
    expect((await remove(await clientToken(tenant.id, client.id, client.email), target.user.id)).status).toBe(401);
    expect(await row(target.user.id)).toBeDefined();
  });
});
