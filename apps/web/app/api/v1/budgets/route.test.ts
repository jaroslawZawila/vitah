import { beforeEach, describe, expect, it, vi } from "vitest";
import { files } from "@repo/core/testing";
import { createTestProject, createTestUser, resetDatabase } from "@repo/db/testing";
import { apiRequest, clientToken, seededObraProject, staffToken } from "../../../../test/api";
import { GET } from "./route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("GET /api/v1/budgets", () => {
  it("lists every obra of the tenant with its newest revision, for any staff member", async () => {
    const { tenant, project } = await seededObraProject();
    const empty = await createTestProject(tenant.id, { ref: "VTH-EMPTY" });
    // Another tenant's obra never shows.
    const other = await seededObraProject();
    const { token } = await staffToken(tenant.id, "viewer");

    const res = await GET(apiRequest(token));

    expect(res.status).toBe(200);
    const { items, summary } = await res.json();
    expect(items.map((i: { projectId: string }) => i.projectId).sort()).toEqual([project.id, empty.id].sort());
    expect(items.map((i: { projectId: string }) => i.projectId)).not.toContain(other.project.id);
    const seeded = items.find((i: { projectId: string }) => i.projectId === project.id);
    expect(seeded.revision).toMatchObject({ status: "accepted", openChecks: null });
    expect(seeded.revision.contractTotalCents).toBeGreaterThan(0);
    expect(items.find((i: { projectId: string }) => i.projectId === empty.id)).toMatchObject({ revision: null, generation: null });
    expect(summary).toMatchObject({ accepted: 1, drafts: 0, contractCents: seeded.revision.contractTotalCents });
  });

  it("needs a staff token", async () => {
    const { tenant } = await seededObraProject();
    const client = await createTestUser(tenant.id, { role: "client" });

    expect((await GET(apiRequest(null))).status).toBe(401);
    expect((await GET(apiRequest(await clientToken(tenant.id, client.id, client.email)))).status).toBe(401);
  });
});
