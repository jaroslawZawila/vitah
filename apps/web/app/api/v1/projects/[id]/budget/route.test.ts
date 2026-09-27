import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, resetDatabase } from "@repo/db/testing";
import { apiRequest, routeParams, staffToken } from "../../../../../../test/api";
import { GET, POST } from "./route";
import { POST as newRevision } from "./revisions/route";
import { DELETE as deleteRevision, PATCH as patchRevision } from "./revisions/[revisionId]/route";
import { POST as accept } from "./revisions/[revisionId]/accept/route";
import { POST as addChapter } from "./revisions/[revisionId]/chapters/route";
import { DELETE as deleteChapter, PATCH as patchChapter } from "./chapters/[chapterId]/route";
import { POST as addLine } from "./chapters/[chapterId]/lines/route";
import { DELETE as deleteLine, PATCH as patchLine } from "./lines/[lineId]/route";
import { PUT as progress } from "./progress/route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

beforeEach(resetDatabase);

async function setup(role: "manager" | "viewer" = "manager") {
  const tenant = await createTestTenant();
  const project = await createTestProject(tenant.id);
  const { token } = await staffToken(tenant.id, role);
  const id = project.id;
  const read = async (query = "") => (await (await GET(apiRequest(token, { query }), routeParams({ id }))).json());
  return { tenant, id, token, read };
}

describe("/api/v1/projects/:id/budget", () => {
  it("drafts, edits, accepts and revises a budget", async () => {
    const { id, token, read } = await setup();

    const created = await POST(apiRequest(token, { method: "POST", body: { reference: "036/2026" } }), routeParams({ id }));
    expect(created.status).toBe(201);
    const { revisionId } = await created.json();

    expect((await patchRevision(apiRequest(token, { method: "PATCH", body: { vatRateBp: 1000 } }), routeParams({ id, revisionId }))).status).toBe(200);
    const chapter = await addChapter(apiRequest(token, { method: "POST", body: { code: "01", name: "Previas" } }), routeParams({ id, revisionId }));
    expect(chapter.status).toBe(201);
    const { chapterId } = await chapter.json();
    expect((await patchChapter(apiRequest(token, { method: "PATCH", body: { name: "Actuaciones previas" } }), routeParams({ id, chapterId }))).status).toBe(200);
    const line = await addLine(
      apiRequest(token, { method: "POST", body: { code: "01.01", description: "Desbroce", unit: "m²", quantity: 265, unitPriceCents: 350 } }),
      routeParams({ id, chapterId }),
    );
    const { lineId } = await line.json();
    expect((await patchLine(apiRequest(token, { method: "PATCH", body: { quantity: 100 } }), routeParams({ id, lineId }))).status).toBe(200);

    expect((await read()).revision).toMatchObject({ totalCents: 35_000, chapters: [{ name: "Actuaciones previas" }] });

    expect((await accept(apiRequest(token, { method: "POST" }), routeParams({ id, revisionId }))).status).toBe(200);
    const saved = await progress(apiRequest(token, { method: "PUT", body: { lines: [{ id: lineId, executedPct: 40 }] } }), routeParams({ id }));
    expect(await saved.json()).toEqual({ updated: 1 });

    const revised = await newRevision(apiRequest(token, { method: "POST" }), routeParams({ id }));
    expect(revised.status).toBe(201);
    const { revisionId: rev1 } = await revised.json();
    const copy = (await read(`?revision=${rev1}`)).revision;
    expect(copy).toMatchObject({ number: 1, status: "draft" });
    expect((await deleteLine(apiRequest(token, { method: "DELETE" }), routeParams({ id, lineId: copy.chapters[0].lines[0].id }))).status).toBe(200);
    expect((await deleteChapter(apiRequest(token, { method: "DELETE" }), routeParams({ id, chapterId: copy.chapters[0].id }))).status).toBe(200);
    expect((await deleteRevision(apiRequest(token, { method: "DELETE" }), routeParams({ id, revisionId: rev1 }))).status).toBe(200);
    expect((await read()).revisions).toHaveLength(1);
  });

  it("returns errors as JSON", async () => {
    const { id, token } = await setup();
    const res = await POST(apiRequest(token, { method: "POST", body: { number: -1 } }), routeParams({ id }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_input" });
  });

  it("is read-only for viewers and needs a token", async () => {
    const { id, token, read } = await setup("viewer");
    expect(await read()).toEqual({ revisions: [], revision: null });
    const res = await POST(apiRequest(token, { method: "POST", body: {} }), routeParams({ id }));
    expect(res.status).toBe(403);
    expect((await GET(apiRequest(null), routeParams({ id }))).status).toBe(401);
  });
});
