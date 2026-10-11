import { beforeEach, describe, expect, it, vi } from "vitest";
import { documentsService } from "@repo/core";
import { files } from "@repo/core/testing";
import { createTestProject, createTestTenant, resetDatabase } from "@repo/db/testing";
import { apiRequest, routeParams, staffToken } from "../../../../../../test/api";
import { GET, POST } from "./route";
import { POST as newRevision } from "./revisions/route";
import { DELETE as deleteRevision, PATCH as patchRevision } from "./revisions/[revisionId]/route";
import { POST as accept } from "./revisions/[revisionId]/accept/route";
import { POST as issue } from "./revisions/[revisionId]/issue/route";
import { POST as reject } from "./revisions/[revisionId]/reject/route";
import { GET as pdf } from "./revisions/[revisionId]/pdf/route";
import { POST as addChapter } from "./revisions/[revisionId]/chapters/route";
import { POST as addOption } from "./revisions/[revisionId]/options/route";
import { DELETE as deleteOption, PATCH as patchOption } from "./options/[optionId]/route";
import { PATCH as patchChapter } from "./chapters/[chapterId]/route";
import { POST as addLine } from "./chapters/[chapterId]/lines/route";
import { DELETE as deleteLine, PATCH as patchLine } from "./lines/[lineId]/route";
import { POST as lineOption } from "./lines/[lineId]/option/route";
import { PUT as progress } from "./progress/route";
import { GET as priceBase } from "./price-base/route";
import { POST as startGeneration } from "./generations/route";
import { GET as generation } from "./generations/[generationId]/route";
import { POST as cancelGeneration } from "./generations/[generationId]/cancel/route";
import { POST as register } from "../documents/register/route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("workflow/api", () => ({
  start: vi.fn().mockResolvedValue({ runId: "run-1" }),
  getRun: vi.fn(() => ({ cancel: vi.fn().mockResolvedValue(undefined) })),
}));
vi.mock("../../../../../../workflows/generate-budget", () => ({ generateBudget: vi.fn() }));
const workflow = await import("workflow/api");

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.mocked(workflow.start).mockClear();
});

async function setup(role: "manager" | "viewer" = "manager") {
  const tenant = await createTestTenant();
  const project = await createTestProject(tenant.id);
  const { token, user } = await staffToken(tenant.id, role);
  const id = project.id;
  const ctx = { tenantId: tenant.id, userId: user.id, role };
  const read = async (query = "") => (await (await GET(apiRequest(token, { query }), routeParams({ id }))).json());
  const post = (body?: unknown) => apiRequest(token, { method: "POST", body });
  const patch = (body: unknown) => apiRequest(token, { method: "PATCH", body });
  const del = () => apiRequest(token, { method: "DELETE" });
  return { ctx, id, token, read, post, patch, del };
}

describe("/api/v1/projects/:id/budget", () => {
  it("keeps the v1 flow: create, edit lines, accept without a body, record progress, revise", async () => {
    const { id, token, read, post, patch, del } = await setup();

    const created = await POST(post({ reference: "036/2026" }), routeParams({ id }));
    expect(created.status).toBe(201);
    const { revisionId } = await created.json();
    expect((await patchRevision(patch({ vatRateBp: 1000 }), routeParams({ id, revisionId }))).status).toBe(200);

    // Every budget now has the 20 FRAMER chapters; the lines go into them.
    const draft = (await read()).revision;
    expect(draft.chapters).toHaveLength(20);
    const chapterId = draft.chapters[0].id;
    expect((await patchChapter(patch({ name: "Actuaciones previas" }), routeParams({ id, chapterId }))).status).toBe(200);
    const line = await addLine(
      post({ code: "01.01", description: "Desbroce", unit: "m²", quantity: 265, unitPriceCents: 350 }),
      routeParams({ id, chapterId }),
    );
    expect(line.status).toBe(201);
    const { lineId } = await line.json();
    expect((await patchLine(patch({ quantity: 100 }), routeParams({ id, lineId }))).status).toBe(200);
    // 350,00 € plus chapter 20's 5 %.
    const edited = (await read()).revision;
    expect(edited.totalCents).toBe(35_000 + 1_750);
    expect(edited.chapters[0]).toMatchObject({ name: "Actuaciones previas", totalCents: 35_000 });

    expect((await accept(post(), routeParams({ id, revisionId }))).status).toBe(200);
    const saved = await progress(apiRequest(token, { method: "PUT", body: { lines: [{ id: lineId, executedPct: 40 }] } }), routeParams({ id }));
    expect(await saved.json()).toEqual({ updated: 1 });

    const revised = await newRevision(post(), routeParams({ id }));
    expect(revised.status).toBe(201);
    const { revisionId: rev1 } = await revised.json();
    const copy = (await read(`?revision=${rev1}`)).revision;
    expect(copy).toMatchObject({ number: 1, status: "draft" });
    expect((await deleteLine(del(), routeParams({ id, lineId: copy.chapters[0].lines[0].id }))).status).toBe(200);
    expect((await deleteRevision(del(), routeParams({ id, revisionId: rev1 }))).status).toBe(200);
    expect((await read()).revisions).toHaveLength(1);
  });

  it("refuses to add a chapter to the fixed 20", async () => {
    const { id, post } = await setup();
    const { revisionId } = await (await POST(post({}), routeParams({ id }))).json();

    const res = await addChapter(post({ code: "21", name: "Extra" }), routeParams({ id, revisionId }));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "fixed_chapters" });
  });

  it("manages options, issues with both PDFs, and accepts with the chosen ones", async () => {
    const { id, token, read, post, patch, del } = await setup();
    const { revisionId } = await (await POST(post({}), routeParams({ id }))).json();
    const chapterId = (await read()).revision.chapters[0].id;
    const { lineId } = await (await addLine(post({ baseCode: "01.01", quantity: 1 }), routeParams({ id, chapterId }))).json();

    const pool = await addOption(post({ name: "Piscina", optionKind: "extra", intro: "Vaso de 8 × 4 m." }), routeParams({ id, revisionId }));
    expect(pool.status).toBe(201);
    const { optionId } = await pool.json();
    expect((await addLine(post({ description: "Vaso", unit: "ud", quantity: 1, unitPriceCents: 2_500_000 }), routeParams({ id, chapterId: optionId }))).status).toBe(201);
    expect((await patchOption(patch({ name: "Piscina exterior" }), routeParams({ id, optionId }))).status).toBe(200);
    const deduction = await lineOption(post({ kind: "deduction" }), routeParams({ id, lineId }));
    expect(deduction.status).toBe(201);
    const { optionId: deductionId } = await deduction.json();
    expect((await read()).revision.options.map((o: { name: string; totalCents: number }) => [o.name, o.totalCents])).toEqual([
      ["Piscina exterior", 2_500_000],
      [expect.any(String), -78_750],
    ]);
    expect((await deleteOption(del(), routeParams({ id, optionId: deductionId }))).status).toBe(200);

    const draftPdf = await pdf(apiRequest(token, { query: "?kind=detailed" }), routeParams({ id, revisionId }));
    expect(draftPdf.status).toBe(200);
    expect(draftPdf.headers.get("content-type")).toBe("application/pdf");
    expect((await pdf(apiRequest(token, { query: "?kind=nope" }), routeParams({ id, revisionId }))).status).toBe(400);

    expect((await issue(post({ issuedOn: "2026-10-01" }), routeParams({ id, revisionId }))).status).toBe(200);
    expect((await read()).revision).toMatchObject({ status: "issued", pdfs: { general: expect.any(String), detailed: expect.any(String) } });
    // An issued revision can't be edited any more.
    expect((await patchOption(patch({ name: "X" }), routeParams({ id, optionId }))).status).toBe(409);

    expect((await accept(post({ acceptedBy: "Ana", chosenOptionIds: [optionId] }), routeParams({ id, revisionId }))).status).toBe(200);
    const accepted = (await read()).revision;
    expect(accepted).toMatchObject({ status: "accepted", acceptedBy: "Ana", contractTotalCents: accepted.totalCents + 2_500_000 });
  }, 60_000);

  it("records that the client rejected an issued revision", async () => {
    const { id, read, post } = await setup();
    const { revisionId } = await (await POST(post({}), routeParams({ id }))).json();

    expect((await reject(post(), routeParams({ id, revisionId }))).status).toBe(409);
    await issue(post({ shareWithClient: false }), routeParams({ id, revisionId }));
    expect((await reject(post({ rejectedOn: "2026-10-03" }), routeParams({ id, revisionId }))).status).toBe(200);
    expect((await read()).revision).toMatchObject({ status: "rejected", rejectedOn: "2026-10-03" });
  }, 60_000);

  it("searches the price base", async () => {
    const { token } = await setup("viewer");
    const res = await priceBase(apiRequest(token, { query: "?q=replanteo&chapter=01" }));
    expect((await res.json())[0]).toMatchObject({ code: "01.01", unit: "ud", unitPriceCents: 78_750 });
    expect((await priceBase(apiRequest(null))).status).toBe(401);
  });

  it("starts the AI over registered budget documents, reports and cancels it", async () => {
    const { ctx, id, token, post } = await setup();
    const { pathname } = await documentsService.budgetInputUpload(ctx, id, "Planos.pdf");
    files.set(pathname, new Blob(["%PDF-1.7 planos"]));
    const registered = await register(post({ pathname, budgetInput: "plans", filename: "Planos.pdf" }), routeParams({ id }));
    expect(registered.status).toBe(201);
    const { documentId } = await registered.json();

    const started = await startGeneration(post({ documentIds: [documentId] }), routeParams({ id }));
    expect(started.status).toBe(201);
    const { generationId } = await started.json();
    expect(workflow.start).toHaveBeenCalledWith(expect.anything(), [generationId]);

    const status = await generation(apiRequest(token), routeParams({ id, generationId }));
    expect(await status.json()).toMatchObject({ id: generationId, status: "queued", step: 0, revisionId: null });
    expect((await cancelGeneration(post(), routeParams({ id, generationId }))).status).toBe(200);
    expect(await (await generation(apiRequest(token), routeParams({ id, generationId }))).json()).toMatchObject({ status: "cancelled" });
  });

  it("returns errors as JSON", async () => {
    const { id, post } = await setup();
    const res = await POST(post({ number: -1 }), routeParams({ id }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid_input" });
    const none = await startGeneration(post({ documentIds: [] }), routeParams({ id }));
    expect(await none.json()).toEqual({ error: "no_documents" });
  });

  it("is read-only for viewers, needs a token, and is scoped to the tenant", async () => {
    const { id, token, read } = await setup("viewer");
    expect(await read()).toEqual({ revisions: [], revision: null, generation: null });
    const res = await POST(apiRequest(token, { method: "POST", body: {} }), routeParams({ id }));
    expect(res.status).toBe(403);
    expect((await startGeneration(apiRequest(token, { method: "POST", body: { documentIds: ["x"] } }), routeParams({ id }))).status).toBe(403);
    expect((await GET(apiRequest(null), routeParams({ id }))).status).toBe(401);

    const other = await createTestTenant();
    const { token: outsider } = await staffToken(other.id);
    expect((await GET(apiRequest(outsider), routeParams({ id }))).status).toBe(404);
  });
});
