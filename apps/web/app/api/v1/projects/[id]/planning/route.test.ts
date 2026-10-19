import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, resetDatabase } from "@repo/db/testing";
import { files } from "@repo/core/testing";
import { apiRequest, routeParams, seededObraProject, staffToken } from "../../../../../../test/api";
import { GET } from "./route";
import { GET as getVersions } from "./versions/route";
import { DELETE as discard, GET as getDraft, POST as create, PUT as update } from "./draft/route";
import { POST as approve } from "./draft/approve/route";
import { GET as getControl } from "../obra/control/route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

const json = (body: unknown, method = "POST") => ({ method, body });
const FIRST_PLAN = { from: "template", startDate: "2026-03-02", region: "as", augustClosure: true, christmasClosure: true };

describe("/api/v1/projects/:id/planning", () => {
  it("generates, edits and approves a plan, which the Obra tab then follows", async () => {
    const { tenant, project } = await seededObraProject();
    const { token } = await staffToken(tenant.id);
    const at = routeParams({ id: project.id });

    const empty = await (await GET(apiRequest(token), at)).json();
    expect(empty).toMatchObject({ baseline: null, draft: null });
    expect(empty.chapters.length).toBeGreaterThan(10);

    const created = await create(apiRequest(token, json(FIRST_PLAN)), at);
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ number: 1 });

    const draft = await (await getDraft(apiRequest(token), at)).json();
    expect(draft.version).toMatchObject({ number: 1, status: "draft", startDate: "2026-03-02" });
    expect(draft.rows[0]).toMatchObject({ code: "01", plannedStart: "2026-10-19" });

    const items = draft.rows.map((r: { code: string; after: string | null; lagDays: number; durationDays: number; fixedStart: string | null }) => ({
      code: r.code,
      after: r.after,
      lagDays: r.lagDays,
      durationDays: r.code === "16" ? 20 : r.durationDays,
      fixedStart: r.fixedStart,
    }));
    const saved = await update(apiRequest(token, json({ items }, "PUT")), at);
    expect(saved.status).toBe(204);
    const edited = await (await getDraft(apiRequest(token), at)).json();
    expect(edited.rows.find((r: { code: string }) => r.code === "16").durationDays).toBe(20);

    expect((await approve(apiRequest(token, json({})), at)).status).toBe(204);
    const planning = await (await GET(apiRequest(token), at)).json();
    expect(planning.baseline).toMatchObject({ number: 1, status: "approved" });
    expect(planning.draft).toBeNull();
    const control = await (await getControl(apiRequest(token), at)).json();
    expect(control.sources.planning).toBe("live");

    const versions = await (await getVersions(apiRequest(token), at)).json();
    expect(versions.versions.map((v: { number: number; status: string }) => [v.number, v.status])).toEqual([[1, "approved"]]);
  });

  it("answers errors as JSON codes", async () => {
    const { tenant, project } = await seededObraProject();
    const { token } = await staffToken(tenant.id);
    const at = routeParams({ id: project.id });

    expect(await (await getDraft(apiRequest(token), at)).json()).toEqual({ error: "not_found" });
    const bad = await create(apiRequest(token, json({ ...FIRST_PLAN, region: "xx" })), at);
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ error: "invalid_input" });

    await create(apiRequest(token, json(FIRST_PLAN)), at);
    expect((await create(apiRequest(token, json(FIRST_PLAN)), at)).status).toBe(409);
    await approve(apiRequest(token, json({})), at);

    await create(apiRequest(token, json({ from: "baseline" })), at);
    const noReason = await approve(apiRequest(token, json({})), at);
    expect(await noReason.json()).toEqual({ error: "change_reason_required" });
    expect((await discard(apiRequest(token, { method: "DELETE" }), at)).status).toBe(204);
    expect((await discard(apiRequest(token, { method: "DELETE" }), at)).status).toBe(404);
  });

  it("lets viewers read only, and keeps other tenants out", async () => {
    const { tenant, project } = await seededObraProject();
    const at = routeParams({ id: project.id });
    const { token: viewer } = await staffToken(tenant.id, "viewer");
    expect((await GET(apiRequest(viewer), at)).status).toBe(200);
    expect((await create(apiRequest(viewer, json(FIRST_PLAN)), at)).status).toBe(403);

    const other = await createTestTenant();
    const { token: stranger } = await staffToken(other.id, "admin");
    expect((await GET(apiRequest(stranger), at)).status).toBe(404);
    expect((await create(apiRequest(stranger, json(FIRST_PLAN)), at)).status).toBe(404);
    expect((await GET(apiRequest(null), at)).status).toBe(401);
  });
});
