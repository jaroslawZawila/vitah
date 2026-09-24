import { beforeEach, describe, expect, it } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { createMobileToken } from "@repo/auth/mobile";
import { projectClientService as svc, type Ctx } from "@repo/core";
import { db, eq, users } from "@repo/db";
import { GET } from "./route";

function get(token?: string) {
  return GET(
    new Request("http://localhost/api/mobile/project", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
  );
}

async function tokenFor(email: string) {
  const user = await db.query.users.findFirst({ where: eq(users.email, email) });
  return createMobileToken({
    sub: user!.id,
    email: user!.email,
    name: user!.name,
    role: user!.role,
    tenantId: user!.tenantId,
  });
}

async function adminCtx(tenantId: string): Promise<Ctx> {
  const admin = await createTestUser(tenantId, { role: "admin" });
  return { tenantId, userId: admin.id, role: "admin" };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("GET /api/mobile/project", () => {
  it("returns the client's project", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id, {
      ref: "VTH-2026-014",
      location: "Calle del Sol 5, Santander",
      startDate: new Date("2026-03-01T00:00:00Z"),
      expectedDeliveryDate: new Date("2026-11-15T00:00:00Z"),
    });
    await svc.createProjectClient(await adminCtx(tenant.id), project.id, {
      name: "Ana",
      email: "ana@example.com",
      password: "client-pass",
    });

    const res = await get(await tokenFor("ana@example.com"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      project: {
        id: project.id,
        ref: "VTH-2026-014",
        address: "Calle del Sol 5, Santander",
        startDate: "2026-03-01",
        completionDate: "2026-11-15",
      },
    });
  });

  it("returns null when no project is attached", async () => {
    const tenant = await createTestTenant();
    await createTestUser(tenant.id, { email: "ana@example.com", role: "client" });

    const res = await get(await tokenFor("ana@example.com"));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ project: null });
  });

  it("returns 401 without a token", async () => {
    const res = await get();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 for an invalid token", async () => {
    expect((await get("garbage")).status).toBe(401);
  });

  it("returns 401 once the client's access is revoked", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);
    await svc.createProjectClient(await adminCtx(tenant.id), project.id, {
      name: "Ana",
      email: "ana@example.com",
      password: "client-pass",
    });
    const token = await tokenFor("ana@example.com");

    await svc.revokeProjectClient(await adminCtx(tenant.id), project.id);

    expect((await get(token)).status).toBe(401);
  });

  it("returns 401 for a staff user's token", async () => {
    const tenant = await createTestTenant();
    await createTestUser(tenant.id, { email: "admin@example.com", role: "admin" });

    expect((await get(await tokenFor("admin@example.com"))).status).toBe(401);
  });
});
