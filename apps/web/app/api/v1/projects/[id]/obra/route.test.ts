import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, resetDatabase } from "@repo/db/testing";
import { files } from "@repo/core/testing";
import { apiRequest, routeParams, seededObraProject, staffToken } from "../../../../../../test/api";
import { GET, PUT } from "./route";
import { GET as getChapter } from "./chapters/[code]/route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

const setup = seededObraProject;

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("/api/v1/projects/:id/obra", () => {
  it("reads the obra and sets its stage", async () => {
    const { tenant, project } = await setup();
    const { token } = await staffToken(tenant.id);

    const res = await GET(apiRequest(token), routeParams({ id: project.id }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stage: 6, progressPct: 52, budget: { number: 3 } });

    const put = await PUT(apiRequest(token, { method: "PUT", body: { stage: 7 } }), routeParams({ id: project.id }));
    expect(await put.json()).toEqual({ stage: 7 });
    const bad = await PUT(apiRequest(token, { method: "PUT", body: { stage: 0 } }), routeParams({ id: project.id }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_stage" });
  });

  it("reads a chapter", async () => {
    const { tenant, project } = await setup();
    const { token } = await staffToken(tenant.id, "viewer");

    const res = await getChapter(apiRequest(token), routeParams({ id: project.id, code: "05" }));
    expect(await res.json()).toMatchObject({ chapter: { code: "05" }, hito: { code: "H4" }, photos: [] });
    const missing = await getChapter(apiRequest(token), routeParams({ id: project.id, code: "99" }));
    expect(missing.status).toBe(404);
  });

  it("needs a token and keeps tenants apart", async () => {
    const { project } = await setup();
    expect((await GET(apiRequest(null), routeParams({ id: project.id }))).status).toBe(401);

    const other = await createTestTenant();
    const { token } = await staffToken(other.id);
    const res = await GET(apiRequest(token), routeParams({ id: project.id }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project_not_found" });
  });
});
