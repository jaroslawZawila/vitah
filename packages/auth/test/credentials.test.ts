import { beforeEach, describe, expect, it } from "vitest";
import { db, loginAttempts } from "@repo/db";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { THROTTLE_WINDOW_MS } from "@repo/core/throttle";
import { attemptSignIn, clientIp, SIGN_IN_LIMITS, verifyCredentials } from "../src/credentials";

beforeEach(async () => {
  await resetDatabase();
});

describe("verifyCredentials", () => {
  it("accepts staff on the portal", async () => {
    const tenant = await createTestTenant();
    const admin = await createTestUser(tenant.id, {
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
      password: "portal-pass",
    });

    expect(await verifyCredentials("admin@example.com", "portal-pass", "portal")).toEqual({
      id: admin.id,
      email: "admin@example.com",
      name: "Admin",
      role: "admin",
      tenantId: tenant.id,
    });
  });

  it("accepts clients on mobile, ignoring email case and whitespace", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, {
      email: "ana@example.com",
      role: "client",
      password: "mobile-pass",
    });

    expect(await verifyCredentials(" Ana@Example.com ", "mobile-pass", "mobile")).toMatchObject({
      id: client.id,
      role: "client",
    });
  });

  it("rejects clients on the portal", async () => {
    const tenant = await createTestTenant();
    await createTestUser(tenant.id, { email: "ana@example.com", role: "client", password: "pass-1234" });

    expect(await verifyCredentials("ana@example.com", "pass-1234", "portal")).toBeNull();
  });

  it.each(["admin", "manager", "viewer"] as const)("rejects %s users on mobile", async (role) => {
    const tenant = await createTestTenant();
    await createTestUser(tenant.id, { email: "staff@example.com", role, password: "pass-1234" });

    expect(await verifyCredentials("staff@example.com", "pass-1234", "mobile")).toBeNull();
  });

  it("finds the client when a staff user elsewhere shares the email", async () => {
    const staffTenant = await createTestTenant();
    await createTestUser(staffTenant.id, { email: "ana@example.com", role: "admin", password: "staff-pass" });
    const clientTenant = await createTestTenant();
    const client = await createTestUser(clientTenant.id, {
      email: "ana@example.com",
      role: "client",
      password: "client-pass",
    });

    expect(await verifyCredentials("ana@example.com", "client-pass", "mobile")).toMatchObject({
      id: client.id,
    });
    expect(await verifyCredentials("ana@example.com", "staff-pass", "portal")).toMatchObject({
      role: "admin",
    });
  });

  it("rejects a wrong password", async () => {
    const tenant = await createTestTenant();
    await createTestUser(tenant.id, { email: "ana@example.com", role: "client", password: "right-pass" });

    expect(await verifyCredentials("ana@example.com", "wrong-pass", "mobile")).toBeNull();
  });

  it("rejects an unknown email", async () => {
    expect(await verifyCredentials("nobody@example.com", "whatever", "mobile")).toBeNull();
  });

  it("rejects an inactive user", async () => {
    const tenant = await createTestTenant();
    await createTestUser(tenant.id, {
      email: "ana@example.com",
      role: "client",
      password: "pass-1234",
      active: false,
    });

    expect(await verifyCredentials("ana@example.com", "pass-1234", "mobile")).toBeNull();
  });

  it("rejects a user of an inactive tenant", async () => {
    const tenant = await createTestTenant({ active: false });
    await createTestUser(tenant.id, { email: "admin@example.com", role: "admin", password: "pass-1234" });

    expect(await verifyCredentials("admin@example.com", "pass-1234", "portal")).toBeNull();
  });
});

describe("verifyCredentials on the portal", () => {
  it("ignores the email's case and whitespace", async () => {
    const tenant = await createTestTenant();
    const admin = await createTestUser(tenant.id, {
      email: "Admin@Example.com",
      role: "admin",
      password: "portal-pass",
    });

    expect(await verifyCredentials(" admin@example.COM ", "portal-pass", "portal")).toMatchObject({
      id: admin.id,
    });
  });
});

describe("attemptSignIn", () => {
  async function client(password = "right-pass") {
    const tenant = await createTestTenant();
    return createTestUser(tenant.id, { email: "ana@example.com", role: "client", password });
  }

  async function fail(times: number, email = "ana@example.com", ip?: string) {
    for (let i = 0; i < times; i++) {
      expect(await attemptSignIn(email, "wrong-pass", "mobile", ip)).toBeNull();
    }
  }

  it("signs in with the right password", async () => {
    const user = await client();

    expect(await attemptSignIn("ana@example.com", "right-pass", "mobile", "1.2.3.4")).toMatchObject({
      id: user.id,
    });
  });

  it("refuses an email after too many failures, even with the right password", async () => {
    await client();
    await fail(SIGN_IN_LIMITS.emailFromIp);

    expect(await attemptSignIn("ana@example.com", "right-pass", "mobile", undefined)).toBe(
      "too_many_attempts",
    );
    // Other emails, and the other audience, are unaffected.
    expect(await attemptSignIn("bob@example.com", "x", "mobile", undefined)).toBeNull();
    expect(await attemptSignIn("ana@example.com", "x", "portal", undefined)).toBeNull();
  });

  it("doesn't lock the owner out when someone else guesses from another IP", async () => {
    await client();
    await fail(SIGN_IN_LIMITS.emailFromIp, "ana@example.com", "6.6.6.6");

    expect(await attemptSignIn("ana@example.com", "right-pass", "mobile", "6.6.6.6")).toBe(
      "too_many_attempts",
    );
    expect(await attemptSignIn("ana@example.com", "right-pass", "mobile", "1.2.3.4")).toMatchObject({
      email: "ana@example.com",
    });
  });

  it("caps guesses at an email across IPs", async () => {
    await client();
    for (let i = 0; i < SIGN_IN_LIMITS.email; i++) {
      await attemptSignIn("ana@example.com", "wrong-pass", "mobile", `10.0.${i >> 8}.${i & 255}`);
    }

    expect(await attemptSignIn("ana@example.com", "right-pass", "mobile", "1.2.3.4")).toBe(
      "too_many_attempts",
    );
  });

  it("counts parallel attempts too", async () => {
    await client();
    const results = await Promise.all(
      Array.from({ length: 3 * SIGN_IN_LIMITS.emailFromIp }, () =>
        attemptSignIn("ana@example.com", "wrong-pass", "mobile", "7.7.7.7"),
      ),
    );

    expect(results.filter((r) => r === null)).toHaveLength(SIGN_IN_LIMITS.emailFromIp);
  });

  it("counts the email in any case", async () => {
    await client();
    await fail(SIGN_IN_LIMITS.emailFromIp, "ANA@example.com");

    expect(await attemptSignIn("ana@example.com", "right-pass", "mobile", undefined)).toBe(
      "too_many_attempts",
    );
  });

  it("refuses an IP after too many failures across emails", async () => {
    await client();
    for (let i = 0; i < SIGN_IN_LIMITS.ip; i++) {
      await attemptSignIn(`guess-${i}@example.com`, "x", "mobile", "9.9.9.9");
    }

    expect(await attemptSignIn("ana@example.com", "right-pass", "mobile", "9.9.9.9")).toBe(
      "too_many_attempts",
    );
    expect(await attemptSignIn("ana@example.com", "right-pass", "mobile", "8.8.8.8")).toMatchObject({
      email: "ana@example.com",
    });
  });

  it("lets the email in again once the window has passed", async () => {
    await client();
    await fail(SIGN_IN_LIMITS.emailFromIp);
    await db
      .update(loginAttempts)
      .set({ windowStart: new Date(Date.now() - THROTTLE_WINDOW_MS - 1000) });

    expect(await attemptSignIn("ana@example.com", "right-pass", "mobile", undefined)).toMatchObject({
      email: "ana@example.com",
    });
  });

  it("forgets the email's failures after a successful sign-in", async () => {
    await client();
    await fail(SIGN_IN_LIMITS.emailFromIp - 1);
    await attemptSignIn("ana@example.com", "right-pass", "mobile", undefined);
    await fail(SIGN_IN_LIMITS.emailFromIp - 1);

    expect(await attemptSignIn("ana@example.com", "right-pass", "mobile", undefined)).toMatchObject({
      email: "ana@example.com",
    });
  });
});

describe("clientIp", () => {
  const req = (headers: Record<string, string>) => new Request("http://localhost/", { headers });

  it("prefers x-real-ip, then the first x-forwarded-for entry", () => {
    expect(clientIp(req({ "x-real-ip": "1.1.1.1", "x-forwarded-for": "2.2.2.2" }))).toBe("1.1.1.1");
    expect(clientIp(req({ "x-forwarded-for": "2.2.2.2, 3.3.3.3" }))).toBe("2.2.2.2");
    expect(clientIp(req({}))).toBeUndefined();
    expect(clientIp(undefined)).toBeUndefined();
  });
});
