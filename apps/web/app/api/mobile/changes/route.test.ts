import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { changesService, obraService } from "@repo/core";
import { clientToken, staffToken } from "../../../../test/api";
import { GET } from "./route";

// lib/api also serves /api/v1, which can read the NextAuth session; next-auth
// itself can't load outside Next.js.
vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

function get(token?: string) {
  return GET(
    new Request("http://localhost/api/mobile/changes", {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
  );
}

async function clientWithProject() {
  const tenant = await createTestTenant();
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, { clientUserId: client.id });
  return { tenant, project, token: await clientToken(tenant.id, client.id, client.email) };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("GET /api/mobile/changes", () => {
  it("returns the counters of the client's project", async () => {
    const { project, token } = await clientWithProject();

    const res = await get(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      changes: { projectId: project.id, project: 0, obra: 0, photos: 0, documents: 0 },
    });
  });

  it("shows a change staff made", async () => {
    const { tenant, project, token } = await clientWithProject();
    const { user } = await staffToken(tenant.id);

    await obraService.setStage({ tenantId: tenant.id, userId: user.id, role: "manager" }, project.id, {
      stage: 5,
    });

    expect((await (await get(token)).json()).changes).toMatchObject({ obra: 1, photos: 0 });
  });

  it("doesn't show another tenant's changes", async () => {
    const { token } = await clientWithProject();
    const other = await clientWithProject();

    await changesService.markChanged(other.tenant.id, other.project.id, ["documents"]);

    expect((await (await get(token)).json()).changes).toMatchObject({ documents: 0 });
  });

  it("returns null when no project is attached", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, { role: "client" });

    const res = await get(await clientToken(tenant.id, client.id, client.email));

    expect(await res.json()).toEqual({ changes: null });
  });

  it("returns 401 without a token", async () => {
    const res = await get();

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("returns 401 for a staff user's token", async () => {
    const tenant = await createTestTenant();
    const { token } = await staffToken(tenant.id, "admin");

    expect((await get(token)).status).toBe(401);
  });
});
