import { beforeEach, describe, expect, it, vi } from "vitest";
import { budgetService, documentsService } from "@repo/core";
import { files } from "@repo/core/testing";
import {
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { signInAs } from "../../test/session";
import {
  acceptRevisionAction,
  addLineAction,
  addOptionAction,
  cancelGenerationAction,
  createRevisionAction,
  deleteLineAction,
  deleteOptionAction,
  deleteRevisionAction,
  getGenerationAction,
  getProjectBudget,
  issueRevisionAction,
  optionFromLineAction,
  rejectRevisionAction,
  searchPriceBaseAction,
  startGenerationAction,
  updateChapterAction,
  updateLineAction,
  updateOptionAction,
  updateRevisionAction,
} from "./budget";
import { budgetInputUploadAction, getProjectDocuments, registerBudgetInputAction } from "./documents";

// The services are covered in packages/core; these tests cover the adapter.

vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const cancelRun = vi.fn().mockResolvedValue(undefined);
vi.mock("workflow/api", () => ({
  start: vi.fn().mockResolvedValue({ runId: "run-1" }),
  getRun: vi.fn(() => ({ cancel: cancelRun })),
}));
// The workflow itself is never run here.
vi.mock("../../workflows/generate-budget", () => ({ generateBudget: vi.fn() }));
const { revalidatePath } = await import("next/cache");
const workflow = await import("workflow/api");

async function setup(role: "admin" | "manager" | "viewer" = "manager") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  const project = await createTestProject(tenant.id);
  const ctx = { tenantId: tenant.id, userId: user.id, role };
  signInAs(ctx);
  return { tenant, project, ctx };
}

const revision = async (projectId: string, revisionId?: string) =>
  (await getProjectBudget(projectId, revisionId))!.budget.revision!;

const chapter = async (projectId: string, code: string) =>
  (await revision(projectId)).chapters.find((c) => c.code === code)!;

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.mocked(revalidatePath).mockClear();
  vi.mocked(workflow.start).mockClear();
  cancelRun.mockClear();
});

describe("budget actions", () => {
  it("edits a draft, issues it with its PDFs, accepts it with an option and starts Rev.1", async () => {
    const { project, ctx } = await setup();
    await budgetService.createBudget(ctx, project.id, { reference: "041/2026" });
    const draft = await revision(project.id);
    expect(draft.chapters.map((c) => c.code)).toHaveLength(20);

    expect(await updateRevisionAction(project.id, draft.id, { contingencyPct: 4, builtAreaM2: 200 })).toEqual({ success: true });
    // The margins, in % of the cost (a new budget starts at 13 % + 6 %).
    expect(await updateRevisionAction(project.id, draft.id, { overheadPct: 12, profitPct: 6 })).toEqual({ success: true });
    expect(await updateRevisionAction(project.id, draft.id, { profitPct: 101 })).toEqual({ error: "invalid_input" });
    expect(await updateRevisionAction(project.id, draft.id, { reviewed: { key: "annex:i1", done: true } })).toEqual({ success: true });
    expect(await updateRevisionAction(project.id, draft.id, { reviewed: { key: "annex:i1", done: "yes" } })).toEqual({ error: "invalid_input" });
    const c01 = await chapter(project.id, "01");
    expect(await updateChapterAction(project.id, c01.id, { pdfNote: "Sobre parcela llana." })).toEqual({ success: true });
    expect(await addLineAction(project.id, c01.id, { baseCode: "01.01", quantity: 1 })).toEqual({ success: true });
    expect(await addLineAction(project.id, c01.id, { baseCode: "01.02", quantity: 300 })).toEqual({ success: true });
    const [survey, clearing] = (await chapter(project.id, "01")).lines;
    expect(await updateLineAction(project.id, clearing!.id, { quantity: 400 })).toEqual({ success: true });
    expect(await optionFromLineAction(project.id, survey!.id, { kind: "deduction" })).toEqual({ success: true });
    expect(await addOptionAction(project.id, draft.id, { baseCode: "10.09" })).toEqual({ success: true });

    let current = await revision(project.id);
    // At cost, 01: 661,76 € + 400 × 3,22 € = 1.949,76 €; 20 = 4 % of that (77,99 €).
    // Each unit price × 1,12 ÷ 0,94: 788,48 € + 400 × 3,84 € + 92,92 € = 2.417,40 €, 389,65 € over
    // the cost: 145,04 € of beneficio industrial (6 % of the price) and the rest gastos asociados.
    expect(current).toMatchObject({ contingencyBp: 400, costCents: 194_976 + 7_799, overheadCents: 24_461, profitCents: 14_504, totalCents: 241_740 });
    expect(current.chapters[0]).toMatchObject({ pdfNote: "Sobre parcela llana." });
    const [deduction, garage] = current.options;
    expect(deduction).toMatchObject({ optionKind: "deduction", totalCents: -66_176 });
    expect(garage).toMatchObject({ name: "Puerta de garaje seccional motorizada", totalCents: 269_118, priceCents: 320_651 });
    expect(await updateOptionAction(project.id, garage!.id, { name: "Puerta de garaje" })).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`, "layout");

    expect(await issueRevisionAction(project.id, draft.id, { issuedOn: "2026-10-01", validUntil: "2026-10-31" })).toEqual({ success: true });
    current = await revision(project.id);
    expect(current).toMatchObject({ status: "issued", issuedOn: "2026-10-01", validUntil: "2026-10-31" });
    const { documents } = await getProjectDocuments(project.id);
    expect(documents.map((d) => [d.budgetPdf, d.visibleToClient])).toEqual(
      expect.arrayContaining([
        ["general", true],
        ["detailed", false],
      ]),
    );

    const form = new FormData();
    form.set("acceptedOn", "2026-10-05");
    form.set("acceptedBy", "Ana");
    form.append("chosenOptionIds", garage!.id);
    form.set("signed", new File(["%PDF-1.7 firmado"], "firmado.pdf", { type: "application/pdf" }));
    expect(await acceptRevisionAction(project.id, draft.id, form)).toEqual({ success: true });
    current = await revision(project.id);
    expect(current).toMatchObject({ status: "accepted", acceptedBy: "Ana", contractTotalCents: current.totalCents + 320_651 });
    // The signed copy is filed with the contracts.
    expect((await getProjectDocuments(project.id)).documents.find((d) => d.category === "contract")).toMatchObject({ title: "Presupuesto 041/2026 · Rev.0 · firmado" });

    expect(await createRevisionAction(project.id)).toEqual({ success: true });
    const budget = (await getProjectBudget(project.id))!.budget;
    expect(budget.revisions.map((r) => [r.number, r.status])).toEqual([
      [1, "draft"],
      [0, "accepted"],
    ]);
    const copy = budget.revision!;
    expect(await issueRevisionAction(project.id, copy.id, { issuedOn: "2026-10-10" })).toEqual({ error: "change_reason_required" });
    expect(await deleteLineAction(project.id, copy.chapters[0]!.lines[0]!.id)).toEqual({ success: true });
    expect(await deleteOptionAction(project.id, copy.options[0]!.id)).toEqual({ success: true });
    expect(await deleteRevisionAction(project.id, copy.id)).toEqual({ success: true });
    expect((await getProjectBudget(project.id))!.budget.revisions).toHaveLength(1);
  }, 60_000);

  it("rejects an issued revision and shows an older one", async () => {
    const { project, ctx } = await setup();
    await budgetService.createBudget(ctx, project.id, {});
    const rev0 = await revision(project.id);
    await issueRevisionAction(project.id, rev0.id, { issuedOn: "2026-10-01", shareWithClient: false });

    expect(await rejectRevisionAction(project.id, rev0.id)).toEqual({ success: true });
    await createRevisionAction(project.id);

    expect(await revision(project.id, rev0.id)).toMatchObject({ number: 0, status: "rejected" });
    expect((await revision(project.id)).number).toBe(1);
    expect(await getProjectBudget(project.id, "nope")).toBeNull();
  }, 60_000);

  it("returns core errors as state", async () => {
    const { project, ctx } = await setup();
    await budgetService.createBudget(ctx, project.id, {});
    const contingency = await chapter(project.id, "20");

    expect(await addLineAction(project.id, contingency.id, { code: "20.02", description: "X", unit: "ud", quantity: 1, unitPriceCents: 100 })).toEqual({ error: "fixed_chapters" });
    expect(await startGenerationAction(project.id, { documentIds: [] })).toEqual({ error: "no_documents" });
  });

  it("starts the AI over uploaded documents, follows it and cancels it", async () => {
    const { project, ctx } = await setup();
    const { pathname } = await budgetInputUploadAction(project.id, "Planos.pdf");
    files.set(pathname!, new Blob(["%PDF-1.7 planos"]));
    expect(await registerBudgetInputAction(project.id, { pathname, budgetInput: "plans", filename: "Planos.pdf" })).toEqual({ success: true });
    const [plans] = (await documentsService.listDocuments(ctx, project.id)).filter((d) => d.budgetInput);

    expect(await startGenerationAction(project.id, { documentIds: [plans!.id], quality: "framer" })).toEqual({ success: true });

    const { generation } = (await getProjectBudget(project.id))!.budget;
    expect(workflow.start).toHaveBeenCalledWith(expect.anything(), [generation!.id]);
    expect(await getGenerationAction(project.id, generation!.id)).toMatchObject({ status: "queued" });
    expect(await startGenerationAction(project.id, { documentIds: [plans!.id] })).toEqual({ error: "generation_running" });

    expect(await cancelGenerationAction(project.id, generation!.id)).toEqual({ success: true });
    expect(workflow.getRun).toHaveBeenCalledWith("run-1");
    expect(cancelRun).toHaveBeenCalled();
    expect(await getGenerationAction(project.id, generation!.id)).toMatchObject({ status: "cancelled" });
  });

  it("marks the AI run failed when its workflow can't start", async () => {
    const { project, ctx } = await setup();
    const { pathname } = await budgetInputUploadAction(project.id, "Planos.pdf");
    files.set(pathname!, new Blob(["%PDF-1.7 planos"]));
    await registerBudgetInputAction(project.id, { pathname, budgetInput: "plans", filename: "Planos.pdf" });
    const [plans] = (await documentsService.listDocuments(ctx, project.id)).filter((d) => d.budgetInput);
    vi.mocked(workflow.start).mockRejectedValueOnce(new Error("queue down"));

    await expect(startGenerationAction(project.id, { documentIds: [plans!.id] })).rejects.toThrow("queue down");

    expect((await getProjectBudget(project.id))!.budget.generation).toMatchObject({ status: "failed", error: "unexpected" });
    // So it can be tried again.
    expect(await startGenerationAction(project.id, { documentIds: [plans!.id] })).toEqual({ success: true });
  });

  it("refuses an upload path for a file type the budget can't read", async () => {
    const { project } = await setup();
    expect(await budgetInputUploadAction(project.id, "planos.dwg")).toEqual({ error: "invalid_file_type" });
  });

  it("searches the price base for any staff member, nothing when signed out", async () => {
    await setup("viewer");
    expect((await searchPriceBaseAction("replanteo", "01"))[0]).toMatchObject({ code: "01.01" });

    signInAs(null);
    expect(await searchPriceBaseAction("replanteo")).toEqual([]);
  });

  it("is read-only for viewers, and empty for other tenants", async () => {
    const { project } = await setup("viewer");
    expect(await getProjectBudget(project.id)).toEqual({
      budget: { revisions: [], revision: null, generation: null },
      canManage: false,
    });
    expect(await startGenerationAction(project.id, { documentIds: ["x"] })).toEqual({ error: "forbidden" });

    await setup();
    expect(await getProjectBudget(project.id)).toBeNull();
  });
});
