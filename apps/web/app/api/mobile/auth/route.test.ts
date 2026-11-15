import { beforeEach, describe, expect, it } from "vitest";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { verifyMobileToken } from "@repo/auth/mobile";
import { POST } from "./route";

/** `ip`: the caller's address, as the proxy in front reports it. */
function post(body: unknown, ip?: string) {
  return POST(
    new Request("http://localhost/api/mobile/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(ip ? { "x-real-ip": ip } : {}) },
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
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
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
    expect(res.headers.get("content-security-policy")).toBe("default-src 'none'; frame-ancestors 'none'");
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

  it("answers 429 to an address after too many failures for the email, the right password included", async () => {
    const tenant = await createTestTenant();
    await createTestUser(tenant.id, { email: "ana@example.com", role: "client", password: "client-pass" });
    for (let i = 0; i < 10; i++) {
      expect((await post({ email: "ana@example.com", password: `guess-${i}` }, "6.6.6.6")).status).toBe(401);
    }

    const res = await post({ email: "ana@example.com", password: "client-pass" }, "6.6.6.6");

    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({ error: "too_many_attempts" });
  });

  it("still signs the client in from their own address while others fail for their email", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, { email: "ana@example.com", role: "client", password: "client-pass" });
    // Past the email's limit of 100, no address past its own 10.
    for (let i = 0; i < 150; i++) {
      await post({ email: "ana@example.com", password: `guess-${i}` }, `10.0.0.${Math.floor(i / 10)}`);
    }

    const res = await post({ email: "ana@example.com", password: "client-pass" }, "1.2.3.4");

    expect(res.status).toBe(200);
    expect((await res.json()).user).toMatchObject({ id: client.id });
  });

  it("gives an unknown email the same answers as a wrong password", async () => {
    for (let i = 0; i < 10; i++) {
      const res = await post({ email: "nobody@example.com", password: `guess-${i}` }, "6.6.6.6");
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "invalid_credentials" });
    }

    expect((await post({ email: "nobody@example.com", password: "x" }, "6.6.6.6")).status).toBe(429);
  });

  it("rejects a malformed body", async () => {
    const res = await post("{not json");

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_body" });
  });
});

describe("POST /api/mobile/auth: what it reads of the body (mobileCredentials in @repo/core)", () => {
  // Installed app builds can't be updated: every body answers exactly as before.
  it.each([
    ["null", 400, "invalid_body"],
    ["[]", 400, "email_and_password_required"],
    ['"ana@example.com"', 400, "email_and_password_required"],
    ["42", 400, "email_and_password_required"],
    [JSON.stringify({ email: "   ", password: "client-pass" }), 400, "email_and_password_required"],
    [JSON.stringify({ email: "ana@example.com", password: "" }), 400, "email_and_password_required"],
    [JSON.stringify({ email: ["ana@example.com"], password: "client-pass" }), 400, "email_and_password_required"],
  ])("answers %s with %i %s", async (body, status, error) => {
    const res = await post(body);
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual({ error });
  });

  it("trims the email, never the password, and ignores other keys", async () => {
    const tenant = await createTestTenant();
    await createTestUser(tenant.id, { email: "ana@example.com", role: "client", password: " client-pass " });

    expect((await post({ email: "  ana@example.com ", password: "client-pass", role: "admin" })).status).toBe(401);
    const res = await post({ email: "  ana@example.com ", password: " client-pass ", tenantId: "other" });
    expect(res.status).toBe(200);
    expect((await res.json()).user).toMatchObject({ role: "client", tenantId: tenant.id });
  });
});
