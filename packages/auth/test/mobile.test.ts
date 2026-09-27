import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, tenants, users } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import {
  authenticateMobileRequest,
  createMobileToken,
  verifyMobileToken,
  type MobileTokenPayload,
} from "../src/mobile";

function requestWith(authorization?: string) {
  return new Request("http://localhost/api/mobile/project", {
    headers: authorization ? { authorization } : {},
  });
}

async function createClient(overrides: { active?: boolean } = {}) {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role: "client", ...overrides });
  const payload: MobileTokenPayload = {
    sub: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    tenantId: tenant.id,
  };
  return { tenant, user, payload, token: await createMobileToken(payload) };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("mobile tokens", () => {
  it("round-trips the payload", async () => {
    const payload: MobileTokenPayload = {
      sub: "user-1",
      email: "ana@example.com",
      name: null,
      role: "client",
      tenantId: "tenant-1",
    };

    expect(await verifyMobileToken(await createMobileToken(payload))).toEqual({
      ...payload,
      iat: expect.any(Number),
    });
  });

  it("rejects a token signed with another secret", async () => {
    const forged = await new SignJWT({ tenantId: "t" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .sign(new TextEncoder().encode("another-secret"));

    await expect(verifyMobileToken(forged)).rejects.toThrow();
  });

  it("rejects an expired token", async () => {
    const expired = await new SignJWT({ tenantId: "t" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET));

    await expect(verifyMobileToken(expired)).rejects.toThrow();
  });
});

describe("authenticateMobileRequest", () => {
  it("returns the payload for an active client", async () => {
    const { token, payload } = await createClient();

    expect(await authenticateMobileRequest(requestWith(`Bearer ${token}`))).toEqual(payload);
  });

  it.each([undefined, "", "Bearer", "Basic abc", "Bearer not-a-jwt"])(
    "rejects authorization header %j",
    async (header) => {
      expect(await authenticateMobileRequest(requestWith(header))).toBeNull();
    },
  );

  it("rejects a deleted client", async () => {
    const { token, user } = await createClient();
    await db.delete(users).where(eq(users.id, user.id));

    expect(await authenticateMobileRequest(requestWith(`Bearer ${token}`))).toBeNull();
  });

  it("rejects a deactivated client", async () => {
    const { token } = await createClient({ active: false });

    expect(await authenticateMobileRequest(requestWith(`Bearer ${token}`))).toBeNull();
  });

  it("rejects a client of a deactivated tenant", async () => {
    const { token, tenant } = await createClient();
    await db.update(tenants).set({ active: false }).where(eq(tenants.id, tenant.id));

    expect(await authenticateMobileRequest(requestWith(`Bearer ${token}`))).toBeNull();
  });

  it("rejects a token issued before the password was changed", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() - 120_000 });
    const { token, user } = await createClient();
    vi.useRealTimers();
    const minuteAgo = new Date(Date.now() - 60_000);
    await db.update(users).set({ passwordChangedAt: minuteAgo }).where(eq(users.id, user.id));

    expect(await authenticateMobileRequest(requestWith(`Bearer ${token}`))).toBeNull();
  });

  it("still accepts it for a few seconds after the change (requests in flight)", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.now() - 120_000 });
    const { token, user, payload } = await createClient();
    vi.useRealTimers();
    await db.update(users).set({ passwordChangedAt: new Date() }).where(eq(users.id, user.id));

    expect(await authenticateMobileRequest(requestWith(`Bearer ${token}`))).toEqual(payload);
  });

  it("accepts a token issued after the password was changed", async () => {
    const { user, payload } = await createClient();
    await db.update(users).set({ passwordChangedAt: new Date() }).where(eq(users.id, user.id));
    const token = await createMobileToken(payload);

    expect(await authenticateMobileRequest(requestWith(`Bearer ${token}`))).toEqual(payload);
  });

  it("rejects a token signed with another algorithm", async () => {
    const { payload } = await createClient();
    const hs512 = await new SignJWT({ role: "client", tenantId: payload.tenantId })
      .setProtectedHeader({ alg: "HS512" })
      .setSubject(payload.sub)
      .sign(new TextEncoder().encode(process.env.NEXTAUTH_SECRET));

    expect(await authenticateMobileRequest(requestWith(`Bearer ${hs512}`))).toBeNull();
  });

  it("rejects a valid token for a staff user", async () => {
    const tenant = await createTestTenant();
    const admin = await createTestUser(tenant.id, { role: "admin" });
    const token = await createMobileToken({
      sub: admin.id,
      email: admin.email,
      name: admin.name,
      role: "admin",
      tenantId: tenant.id,
    });

    expect(await authenticateMobileRequest(requestWith(`Bearer ${token}`))).toBeNull();
  });
});
