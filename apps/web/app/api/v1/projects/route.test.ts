import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { createMobileToken } from "@repo/auth/mobile";
import type { UserRole } from "@repo/db";
import { apiRequest, routeParams, seededObraProject, staffToken } from "../../../../test/api";
import { GET as getControl } from "./[id]/obra/control/route";
import { GET, POST } from "./route";

// Bearer requests never read the NextAuth session, and next-auth itself
// can't load outside Next.js.
vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

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

function get(token: string, query = "") {
  return GET(
    new Request(`http://localhost/api/v1/projects${query}`, {
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
        obraStage: 1,
        clientUserId: client.id,
        client: { id: client.id, name: "Ana", email: client.email },
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
        // Added for the portal's project list; older clients ignore it.
        budget: { revision: null, generation: null },
      },
    ]);
  });

  it("adds each obra's signals only when asked for, with ?signals=1", async () => {
    const tenant = await createTestTenant();
    await createTestProject(tenant.id);
    const token = await tokenFor(tenant.id, "viewer");

    const [plain] = await (await get(token)).json();
    expect(plain).not.toHaveProperty("schedule");
    expect(plain).not.toHaveProperty("progressPct");
    expect(plain).not.toHaveProperty("attention");
    const [withSignals] = await (await get(token, "?signals=1")).json();
    expect(withSignals).toEqual({ ...plain, schedule: null, progressPct: null, attention: [] });
  });

  it("gives an obra with a contract its schedule and built %, as its Obra tab", async () => {
    const { tenant, project } = await seededObraProject();
    const { token } = await staffToken(tenant.id, "viewer");

    const [listed] = await (await get(token, "?signals=1")).json();
    const control = await (await getControl(apiRequest(token), routeParams({ id: project.id }))).json();
    // No approved plan and no project dates: nothing to measure against.
    expect(listed.schedule).toEqual({ status: control.schedule.status, worst: control.schedule.worst, days: null });
    expect(listed.schedule.status).toBe("no_dates");
    expect(listed.progressPct).toEqual(expect.any(Number));
    // The seed's H3 was invoiced on 24/09 and is still unpaid, past its due day.
    expect(listed.attention).toEqual([{ kind: "collection_overdue", count: 1 }]);
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
