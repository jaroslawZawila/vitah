import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { clientToken, staffToken } from "../../../../test/api";
import { GET } from "./route";

// lib/api also serves /api/v1, which can read the NextAuth session; next-auth
// itself can't load outside Next.js.
vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

function get(token?: string) {
  return GET(
    new Request("http://localhost/api/mobile/projects", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
  );
}

beforeEach(async () => {
  await resetDatabase();
});

describe("GET /api/mobile/projects", () => {
  it("lists the client's projects, the newest open one first", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, { role: "client" });
    const handedOver = await createTestProject(tenant.id, {
      clientUserId: client.id,
      ref: "VTH-24-007",
      address: "Barrio La Sierra 4, Liencres",
      startDate: new Date("2024-02-01"),
      completionDate: new Date("2025-06-12"),
      obraStage: 8,
    });
    const open = await createTestProject(tenant.id, {
      clientUserId: client.id,
      ref: "VTH-26-001",
      startDate: new Date("2026-03-10"),
    });
    await createTestProject(tenant.id, { clientUserId: (await createTestUser(tenant.id, { role: "client" })).id });

    const res = await get(await clientToken(tenant.id, client.id, client.email));

    expect(res.status).toBe(200);
    const { projects } = await res.json();
    expect(projects.map((p: { id: string }) => p.id)).toEqual([open.id, handedOver.id]);
    expect(projects[1]).toEqual({
      id: handedOver.id,
      ref: "VTH-24-007",
      address: "Barrio La Sierra 4, Liencres",
      startDate: "2024-02-01",
      completionDate: "2025-06-12",
      handedOver: true,
      progressPct: null,
    });
  });

  it("is empty without a project, and never lists another tenant's", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, { role: "client" });
    const other = await createTestTenant();
    await createTestProject(other.id);

    expect(await (await get(await clientToken(tenant.id, client.id, client.email))).json()).toEqual({ projects: [] });
  });

  it("returns 401 without a token, or for a staff user's", async () => {
    const tenant = await createTestTenant();
    const { token } = await staffToken(tenant.id, "admin");

    expect((await get()).status).toBe(401);
    expect((await get(token)).status).toBe(401);
  });
});
