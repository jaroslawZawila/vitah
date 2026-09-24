import { beforeEach, describe, expect, it } from "vitest";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { verifyCredentials } from "../src/credentials";

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
