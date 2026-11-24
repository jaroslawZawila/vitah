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
import { NOT_FOUND, TO_LOGIN } from "../../test/navigation";
import {
  acceptRevisionAction,
  addLineAction,
  addOptionAction,
  cancelGenerationAction,
  createExclusionPresetAction,
  createRevisionAction,
  deleteExclusionPresetAction,
  deleteLineAction,
  deleteOptionAction,
  deleteRevisionAction,
  getExclusionPresets,
  getGenerationAction,
  getProjectBudget,
  issueRevisionAction,
  optionFromLineAction,
  rejectRevisionAction,
  searchPriceBaseAction,
  startGenerationAction,
  takeProjectDataAction,
  updateChapterAction,
  updateExclusionPresetAction,
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
    // The margins, each in % of the price (a new budget starts at 16 % + 9 %), together under 100 %.
    expect(await updateRevisionAction(project.id, draft.id, { overheadPct: 12, profitPct: 6 })).toEqual({ success: true });
    expect(await updateRevisionAction(project.id, draft.id, { profitPct: 101 })).toEqual({ error: "invalid_input" });
    expect(await updateRevisionAction(project.id, draft.id, { overheadPct: 50, profitPct: 50 })).toEqual({ error: "invalid_input" });
    expect(await updateRevisionAction(project.id, draft.id, { reviewed: { key: "annex:i1", done: true } })).toEqual({ success: true });
    // A wrong type, as a caller past the types could send it.
    expect(await updateRevisionAction(project.id, draft.id, { reviewed: { key: "annex:i1", done: "yes" } } as never)).toEqual({ error: "invalid_input" });
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
    // Each unit price ÷ 0,82: 807,02 € + 400 × 3,93 € + 95,11 € = 2.474,13 €: 296,90 € of gastos asociados
    // (12 % of the price), 148,45 € of beneficio industrial (6 %) and 1,03 € of the unit prices' rounding.
    expect(current).toMatchObject({
      contingencyBp: 400,
      costCents: 194_976 + 7_799,
      overheadCents: 29_690,
      profitCents: 14_845,
      roundingCents: 103,
      totalCents: 247_413,
    });
    expect(current.chapters[0]).toMatchObject({ pdfNote: "Sobre parcela llana." });
    const [deduction, garage] = current.options;
    expect(deduction).toMatchObject({ optionKind: "deduction", totalCents: -66_176 });
    expect(garage).toMatchObject({ name: "Puerta de garaje seccional motorizada", totalCents: 269_118, priceCents: 328_193 });
    expect(await updateOptionAction(project.id, garage!.id, { name: "Puerta de garaje" })).toEqual({ success: true });
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`, "layout");

    // Still a draft, never sent to the client: it can't be accepted from the portal.
    expect(await acceptRevisionAction(project.id, draft.id, new FormData())).toEqual({ error: "not_issued" });
    expect((await revision(project.id)).status).toBe("draft");

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
    form.set("acceptedBy", "Ana");
    form.append("chosenOptionIds", garage!.id);
    form.set("signed", new File(["%PDF-1.7 firmado"], "firmado.pdf", { type: "application/pdf" }));
    // Accepted between the day it was issued and today.
    for (const acceptedOn of ["2026-09-30", "2999-01-01"]) {
      form.set("acceptedOn", acceptedOn);
      expect(await acceptRevisionAction(project.id, draft.id, form)).toEqual({ error: "invalid_date" });
    }
    form.set("acceptedOn", "2026-10-05");
    expect(await acceptRevisionAction(project.id, draft.id, form)).toEqual({ success: true });
    current = await revision(project.id);
    expect(current).toMatchObject({ status: "accepted", acceptedOn: "2026-10-05", acceptedBy: "Ana", contractTotalCents: current.totalCents + 328_193 });
    // Registered by the signed-in user, with the signed copy filed with the contracts.
    expect(current.acceptedByUser).toMatchObject({ id: ctx.userId });
    const contract = (await getProjectDocuments(project.id)).documents.find((d) => d.category === "contract")!;
    expect(contract).toMatchObject({ title: "Presupuesto 041/2026 · Rev.0 · firmado" });
    expect(current.signedDocumentId).toBe(contract.id);

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
    // A revision that isn't there is for the page to handle (it shows the newest): null, not "No encontrado".
    expect(await getProjectBudget(project.id, "nope")).toBeNull();
  }, 60_000);

  it("gives a draft's cover the project's address, and refuses once it is issued", async () => {
    const { project, ctx } = await setup();
    await budgetService.createBudget(ctx, project.id, {});
    const draft = await revision(project.id);
    await updateRevisionAction(project.id, draft.id, { texts: { cover: { site: "Calle Castelar 12" } } });
    expect((await revision(project.id)).identity?.differs).toEqual(["site"]);
    vi.mocked(revalidatePath).mockClear();

    expect(await takeProjectDataAction(project.id, draft.id)).toEqual({ success: true });
    expect((await revision(project.id)).texts.cover.site).toBe("Calle Mayor 1, Santander");
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`, "layout");

    await issueRevisionAction(project.id, draft.id, { issuedOn: "2026-10-01", shareWithClient: false });
    expect(await takeProjectDataAction(project.id, draft.id)).toEqual({ error: "not_draft" });
    signInAs({ ...ctx, role: "viewer" });
    expect(await takeProjectDataAction(project.id, draft.id)).toEqual({ error: "forbidden" });
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
    expect(await registerBudgetInputAction(project.id, { pathname: pathname!, budgetInput: "plans", filename: "Planos.pdf" })).toEqual({ success: true });
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
    await registerBudgetInputAction(project.id, { pathname: pathname!, budgetInput: "plans", filename: "Planos.pdf" });
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

  it("searches the price base for any staff member; signed out, the login page", async () => {
    await setup("viewer");
    expect((await searchPriceBaseAction("replanteo", "01"))[0]).toMatchObject({ code: "01.01" });
    // Nothing found is the only empty answer.
    expect(await searchPriceBaseAction("zzzz-no-such-partida")).toEqual([]);

    signInAs(null);
    await expect(searchPriceBaseAction("replanteo")).rejects.toEqual(TO_LOGIN);
  });

  it("is read-only for viewers, and empty for other tenants", async () => {
    const { project } = await setup("viewer");
    expect(await getProjectBudget(project.id)).toEqual({
      budget: { revisions: [], revision: null, generation: null },
      canManage: false,
    });
    expect(await startGenerationAction(project.id, { documentIds: ["x"] })).toEqual({ error: "forbidden" });

    await setup();
    await expect(getProjectBudget(project.id)).rejects.toEqual(NOT_FOUND);
    // The open page's poll just stops following a run that is gone.
    expect(await getGenerationAction(project.id, "nope")).toBeNull();
  });
});

describe("the library of Gastos no incluidos", () => {
  it("lists the template's lines, adds, edits and removes one, and ticks lines on a draft", async () => {
    const { project, ctx } = await setup();
    await budgetService.createBudget(ctx, project.id, {});
    const draft = await revision(project.id);
    const presets = await getExclusionPresets();
    expect(presets.map((p) => p.label)).toEqual(draft.texts.exclusions);

    expect(await createExclusionPresetAction(project.id, { label: "Piscina" })).toEqual({ success: true });
    const piscina = (await getExclusionPresets()).find((p) => p.label === "Piscina")!;
    expect(await updateExclusionPresetAction(project.id, piscina.id, { label: presets[0]!.label })).toEqual({ error: "exclusion_exists" });
    expect(await updateExclusionPresetAction(project.id, piscina.id, { label: "Piscina y depuradora" })).toEqual({ success: true });
    expect(await deleteExclusionPresetAction(project.id, presets[1]!.id)).toEqual({ success: true });
    expect((await getExclusionPresets()).map((p) => p.label)).toEqual([
      presets[0]!.label,
      ...presets.slice(2).map((p) => p.label),
      "Piscina y depuradora",
    ]);
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`, "layout");

    // Ticking on the draft: one line at a time, with "save for other projects".
    expect(await updateRevisionAction(project.id, draft.id, { exclusion: { text: presets[0]!.label, included: false } })).toEqual({ success: true });
    expect(await updateRevisionAction(project.id, draft.id, { exclusion: { text: "Acometidas", included: true, save: true } })).toEqual({ success: true });
    const exclusions = (await revision(project.id)).texts.exclusions;
    expect(exclusions).not.toContain(presets[0]!.label);
    expect(exclusions).toContain("Acometidas");
    expect((await getExclusionPresets()).map((p) => p.label)).toContain("Acometidas");
  });

  it("is written by admins and managers only, each tenant its own", async () => {
    const { project } = await setup("viewer");
    const [preset] = await getExclusionPresets();
    expect(await createExclusionPresetAction(project.id, { label: "x" })).toEqual({ error: "forbidden" });
    expect(await updateExclusionPresetAction(project.id, preset!.id, { label: "x" })).toEqual({ error: "forbidden" });
    expect(await deleteExclusionPresetAction(project.id, preset!.id)).toEqual({ error: "forbidden" });

    await setup();
    expect(await deleteExclusionPresetAction(project.id, preset!.id)).toEqual({ error: "not_found" });
    expect(await createExclusionPresetAction(project.id, { label: " " })).toEqual({ error: "missing_fields" });
  });

  it("sends a signed-out caller to the login page", async () => {
    signInAs(null);
    await expect(getExclusionPresets()).rejects.toEqual(TO_LOGIN);
    await expect(createExclusionPresetAction("p", { label: "x" })).rejects.toEqual(TO_LOGIN);
  });
});
