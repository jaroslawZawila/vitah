import { beforeEach, describe, expect, it } from "vitest";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { verifyMobileToken } from "@repo/auth/mobile";
import { POST } from "./route";

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/mobile/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

beforeEach(async () => {
  await resetDatabase();
});

describe("POST /api/mobile/auth", () => {
  it("returns a token and the user for valid client credentials", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, {
      email: "ana@example.com",
      name: "Ana",
      role: "client",
      password: "client-pass",
    });

    const res = await post({ email: "ana@example.com", password: "client-pass" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toEqual({
      id: client.id,
      email: "ana@example.com",
      name: "Ana",
      role: "client",
      tenantId: tenant.id,
    });
    expect(await verifyMobileToken(body.token)).toMatchObject({
      sub: client.id,
      tenantId: tenant.id,
      role: "client",
    });
  });

  it("rejects staff credentials", async () => {
    const tenant = await createTestTenant();
    await createTestUser(tenant.id, { email: "admin@example.com", role: "admin", password: "admin-pass" });

    const res = await post({ email: "admin@example.com", password: "admin-pass" });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "invalid_credentials" });
  });

  it("rejects a wrong password", async () => {
    const tenant = await createTestTenant();
    await createTestUser(tenant.id, { email: "ana@example.com", role: "client", password: "client-pass" });

    const res = await post({ email: "ana@example.com", password: "nope" });

    expect(res.status).toBe(401);
  });

  it.each([{}, { email: "ana@example.com" }, { password: "x" }, { email: 1, password: 2 }])(
    "requires email and password: %j",
    async (body) => {
      const res = await post(body);

      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "email_and_password_required" });
    },
  );

  it("rejects a malformed body", async () => {
    const res = await post("{not json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });
});
