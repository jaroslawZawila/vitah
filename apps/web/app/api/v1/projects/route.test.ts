import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { createMobileToken } from "@repo/auth/mobile";
import type { UserRole } from "@repo/db";
import { GET, POST } from "./route";

// Bearer requests never read the NextAuth session, and next-auth itself
// can't load outside Next.js.
vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

async function tokenFor(tenantId: string, role: UserRole) {
  const user = await createTestUser(tenantId, { role });
  return createMobileToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role,
    tenantId,
  });
}

function get(token: string) {
  return GET(
    new Request("http://localhost/api/v1/projects", {
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
}

beforeEach(async () => {
  await resetDatabase();
});

describe("GET /api/v1/projects", () => {
  it("lists the tenant's projects for a staff token", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);

    const res = await get(await tokenFor(tenant.id, "manager"));

    expect(res.status).toBe(200);
    expect((await res.json()).map((p: { id: string }) => p.id)).toEqual([project.id]);
  });

  it("rejects a client's token: clients only see their own project via /api/mobile", async () => {
    const tenant = await createTestTenant();
    await createTestProject(tenant.id);

    const res = await get(await tokenFor(tenant.id, "client"));

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns the minimal project shape with the client", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, { role: "client", name: "Ana" });
    const project = await createTestProject(tenant.id, {
      ref: "VTH-1",
      address: "Calle 1",
      startDate: new Date("2026-03-01T00:00:00Z"),
      clientUserId: client.id,
    });

    const res = await get(await tokenFor(tenant.id, "viewer"));

    expect(await res.json()).toEqual([
      {
        id: project.id,
        tenantId: tenant.id,
        ref: "VTH-1",
        address: "Calle 1",
        startDate: "2026-03-01T00:00:00.000Z",
        completionDate: null,
        clientUserId: client.id,
        client: { id: client.id, name: "Ana", email: client.email },
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    ]);
  });
});

describe("POST /api/v1/projects", () => {
  function post(token: string, body: unknown) {
    return POST(
      new Request("http://localhost/api/v1/projects", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  }

  it("creates a project", async () => {
    const tenant = await createTestTenant();

    const res = await post(await tokenFor(tenant.id, "manager"), {
      ref: "VTH-1",
      address: "Calle 1",
      completionDate: "2026-11-15",
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: expect.any(String) });
  });

  it("returns validation errors as JSON", async () => {
    const tenant = await createTestTenant();
    const token = await tokenFor(tenant.id, "manager");

    const missing = await post(token, { ref: "VTH-1" });
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "missing_fields" });

    const notObject = await post(token, ["VTH-1"]);
    expect(notObject.status).toBe(400);
    expect(await notObject.json()).toEqual({ error: "invalid_body" });
  });
});
