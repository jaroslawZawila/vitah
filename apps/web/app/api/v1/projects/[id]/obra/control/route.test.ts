import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, resetDatabase } from "@repo/db/testing";
import { files } from "@repo/core/testing";
import { apiRequest, routeParams, seededObraProject, staffToken } from "../../../../../../../test/api";
import { GET } from "./route";
import { GET as getCosts } from "../costs/route";
import { POST as review } from "../review/route";
import { GET as getChapter, PATCH as correct } from "../chapters/[code]/control/route";
import { GET as getHeader } from "../header/route";
import { POST as start } from "../chapters/[code]/start/route";
import { POST as finish } from "../chapters/[code]/finish/route";
import { GET as listIssues, POST as createIssue } from "../issues/route";
import { PATCH as updateIssue } from "../issues/[issueId]/route";
import { POST as addFile } from "../issues/[issueId]/files/route";
import { DELETE as deleteFile, GET as getFile } from "../issues/[issueId]/files/[fileId]/route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

const json = (body: unknown, method = "POST") => ({ method, body });

describe("/api/v1/projects/:id/obra/control", () => {
  it("reads the summary, the costs and a chapter", async () => {
    const { tenant, project } = await seededObraProject();
    const { token } = await staffToken(tenant.id, "viewer");

    const res = await GET(apiRequest(token), routeParams({ id: project.id }));
    expect(res.status).toBe(200);
    const control = await res.json();
    expect(control.chapters.map((c: { code: string }) => c.code)).not.toContain("20");
    expect(control.sources).toEqual({ planning: "mock", purchasing: "mock" });

    const header = await (await getHeader(apiRequest(token), routeParams({ id: project.id }))).json();
    expect(header).toMatchObject({ ref: project.ref, openIssues: 0, today: "2026-10-17" });

    const costs = await (await getCosts(apiRequest(token), routeParams({ id: project.id }))).json();
    expect(costs.chapters[0].lines[0]).toHaveProperty("costCents");

    const chapter = await getChapter(apiRequest(token), routeParams({ id: project.id, code: "06" }));
    expect(await chapter.json()).toMatchObject({ chapter: { code: "06", state: "pending" }, milestone: { code: "H4" } });
    const missing = await getChapter(apiRequest(token), routeParams({ id: project.id, code: "99" }));
    expect(missing.status).toBe(404);
  });

  it("starts, finishes and corrects a chapter", async () => {
    const { tenant, project } = await seededObraProject();
    const { token } = await staffToken(tenant.id);
    const at = (code: string) => routeParams({ id: project.id, code });

    const started = await start(apiRequest(token, json({ date: "2026-09-21" })), at("05"));
    expect(await started.json()).toEqual({ state: "in_progress" });
    const twice = await start(apiRequest(token, json({ date: "2026-09-22" })), at("05"));
    expect(twice.status).toBe(409);
    expect(await twice.json()).toEqual({ error: "invalid_state" });

    const late = await finish(apiRequest(token, json({ date: "2026-10-18" })), at("05"));
    expect(await late.json()).toEqual({ error: "invalid_date" });
    const finished = await finish(apiRequest(token, json({ date: "2026-10-09" })), at("05"));
    expect(await finished.json()).toEqual({ state: "finished", invoiceRequested: null });

    const corrected = await correct(apiRequest(token, json({ actualEnd: null, note: "Faltan remates" }, "PATCH")), at("05"));
    expect(await corrected.json()).toEqual({ state: "in_progress", invoiceRequested: null });

    const bad = await start(apiRequest(token, { method: "POST", body: "nope" }), at("06"));
    expect(bad.status).toBe(400);
  });

  it("marks the revision's changes as reviewed", async () => {
    const { tenant, project } = await seededObraProject();
    const { token } = await staffToken(tenant.id);
    const res = await review(apiRequest(token, { method: "POST" }), routeParams({ id: project.id }));
    expect(res.status).toBe(200);
  });

  it("logs issues and changes with their files", async () => {
    const { tenant, project } = await seededObraProject();
    const { token } = await staffToken(tenant.id);
    const id = project.id;

    const created = await createIssue(
      apiRequest(token, json({ kind: "change", occurredOn: "2026-09-30", chapterCode: "10", description: "Corredera elevable", party: "client", costImpactCents: 235_000 })),
      routeParams({ id }),
    );
    expect(created.status).toBe(201);
    const { issueId, number } = await created.json();
    expect(number).toBe(1);
    const missing = await createIssue(apiRequest(token, json({ kind: "issue" })), routeParams({ id }));
    expect(await missing.json()).toEqual({ error: "missing_fields" });

    const updated = await updateIssue(apiRequest(token, json({ status: "review" }, "PATCH")), routeParams({ id, issueId }));
    expect(await updated.json()).toEqual({ issueId });

    const form = new FormData();
    form.set("file", new File(["%PDF-1.7 presupuesto"], "Presupuesto corredera.pdf", { type: "application/pdf" }));
    const uploaded = await addFile(apiRequest(token, { method: "POST", body: form }), routeParams({ id, issueId }));
    expect(uploaded.status).toBe(201);
    const { fileId } = await uploaded.json();

    const download = await getFile(apiRequest(token), routeParams({ id, issueId, fileId }));
    expect(download.headers.get("Content-Disposition")).toMatch(/^attachment;/);
    expect(await download.text()).toBe("%PDF-1.7 presupuesto");

    const changes = await (await listIssues(apiRequest(token, { query: "?kind=change" }), routeParams({ id }))).json();
    expect(changes).toMatchObject([{ id: issueId, status: "review", files: [{ id: fileId }] }]);
    expect(await (await listIssues(apiRequest(token, { query: "?kind=issue" }), routeParams({ id }))).json()).toEqual([]);

    const removed = await deleteFile(apiRequest(token, { method: "DELETE" }), routeParams({ id, issueId, fileId }));
    expect(await removed.json()).toEqual({ fileId });
  });

  it("needs a token, lets viewers only read, and keeps tenants apart", async () => {
    const { tenant, project } = await seededObraProject();
    expect((await GET(apiRequest(null), routeParams({ id: project.id }))).status).toBe(401);

    const viewer = await staffToken(tenant.id, "viewer");
    const denied = await start(apiRequest(viewer.token, json({ date: "2026-10-01" })), routeParams({ id: project.id, code: "06" }));
    expect(denied.status).toBe(403);

    const other = await createTestTenant();
    const { token } = await staffToken(other.id);
    const res = await GET(apiRequest(token), routeParams({ id: project.id }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project_not_found" });
    const issues = await listIssues(apiRequest(token), routeParams({ id: project.id }));
    expect(issues.status).toBe(404);
  });
});
