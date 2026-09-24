import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { createMobileToken } from "@repo/auth/mobile";
import type { UserRole } from "@repo/db";
import { GET } from "./route";

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
});
