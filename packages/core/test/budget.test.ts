import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { budgetChapters, budgetLines, budgetRevisions, db, eq, projects } from "@repo/db";
import {
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import {
  budgetIssueService as issue,
  budgetOptionsService as options,
  budgetService as svc,
  documentsService,
  hitosService,
  obraService,
  BUDGET_CHAPTER_CODES,
  MAX_AMOUNT_CENTS,
  type Ctx,
} from "../src";
import { lockProject } from "../src/budget-draft";
import { CHAPTER_NAMES } from "../src/budget-template";
import { contractValues, fill } from "../src/budget-pdf/format";
import { CONTRACT_CLAUSES, CONTRACT_INTRO } from "../src/budget-template-texts";
import * as storage from "../src/storage";
import { files } from "../src/testing";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));

async function setup(role: Ctx["role"] = "manager") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, { clientUserId: client.id });
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role };
  return { tenant, client, project, ctx };
}

const line = (code: string, quantity: number, unitPriceCents: number) => ({
  code,
  description: `Partida ${code}`,
  unit: "m²",
  quantity,
  unitPriceCents,
});

/** A draft with 01 (927,50 + 725,00) and 02 (1.000,00): PEC 2.652,50 + 5 % = 2.785,13. */
async function draftBudget(ctx: Ctx, projectId: string) {
  const { revisionId, chapterId } = await framerDraft(ctx, projectId, []);
  await svc.addLine(ctx, projectId, chapterId("01"), line("01.01", 265, 350)); // 927,50
  await svc.addLine(ctx, projectId, chapterId("01"), line("01.02", 10, 7_250)); // 725,00
  await svc.addLine(ctx, projectId, chapterId("02"), line("02.01", 1, 1_000_00)); // 1.000,00
  return { revisionId, c1: chapterId("01"), c2: chapterId("02"), chapterId };
}

const revisionOf = async (ctx: Ctx, projectId: string, revisionId?: string) =>
  (await svc.getBudget(ctx, projectId, revisionId)).revision!;

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("createBudget", () => {
  it("starts Rev.0 as a draft with the twenty FRAMER chapters and the standard hitos H0–H9", async () => {
    const { project, ctx } = await setup();

    const { revisionId } = await svc.createBudget(ctx, project.id, { reference: "036/2026" });

    const budget = await svc.getBudget(ctx, project.id);
    expect(budget.revisions).toEqual([
      { id: revisionId, number: 0, status: "draft", totalCents: 0, acceptedAt: null, issuedOn: null },
    ]);
    expect(budget.generation).toBeNull();
    const revision = budget.revision!;
    expect(revision).toMatchObject({ reference: "036/2026", vatRateBp: 1000, model: "framer20", contingencyBp: 500, options: [] });
    // Priced at cost: gastos asociados and beneficio industrial go on top.
    expect(revision).toMatchObject({ overheadBp: 1600, profitBp: 900, costCents: 0, overheadCents: 0, profitCents: 0, roundingCents: 0 });
    expect(revision.chapters.map((c) => [c.code, c.name])).toEqual(BUDGET_CHAPTER_CODES.map((code) => [code, CHAPTER_NAMES[code]]));
    // Chapter 20 is one computed line, at 0 while 01–19 are empty.
    expect(revision.chapters[19]!.lines).toMatchObject([{ code: "20.01", source: "computed", amountCents: 0 }]);
    expect(revision.texts.exclusions.length).toBeGreaterThan(0);
    expect(revision.conditions.validityDays).toBe(90);
    const hitos = await hitosService.listHitos(ctx, project.id);
    expect(hitos.map((h) => h.code)).toEqual(["H0", "H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9"]);
    expect(hitos.reduce((sum, h) => sum + h.pctBp, 0)).toBe(10_000);
  });

  it("can start at a later revision number, and only once", async () => {
    const { project, ctx } = await setup();
    await svc.createBudget(ctx, project.id, { number: 3 });
    expect((await svc.getBudget(ctx, project.id)).revisions[0]?.number).toBe(3);
    await expect(svc.createBudget(ctx, project.id, {})).rejects.toMatchObject({ code: "budget_exists", status: 409 });
  });
});

describe("chapters and lines", () => {
  it("adds up amounts, chapter 20, totals, shares and VAT", async () => {
    const { project, ctx } = await setup();
    await draftBudget(ctx, project.id);

    const revision = await revisionOf(ctx, project.id);

    // 2.652,50 € + 5 % (132,63 €).
    expect(revision).toMatchObject({ totalCents: 278_513, contractTotalCents: 278_513, vatCents: 27_851 });
    const [c1, c2] = revision.chapters;
    expect(c1).toMatchObject({ code: "01", totalCents: 165_250, shareBp: 5933, change: null, previousTotalCents: null });
    expect(c1?.lines.map((l) => [l.code, l.quantity, l.amountCents, l.source])).toEqual([
      ["01.01", 265, 92_750, "manual"],
      ["01.02", 10, 72_500, "manual"],
    ]);
    expect(c2).toMatchObject({ code: "02", totalCents: 100_000 });
    expect(revision.chapters[19]).toMatchObject({ code: "20", totalCents: 13_263 });
  });

  it("keeps chapter 20 at its share of 01–19 through every edit", async () => {
    const { project, ctx } = await setup();
    const { revisionId, c2 } = await draftBudget(ctx, project.id);
    const contingency = async () => (await revisionOf(ctx, project.id)).chapters[19]!.totalCents;

    const { lineId } = await svc.addLine(ctx, project.id, c2, line("02.02", 2, 50_000)); // +1.000,00
    expect(await contingency()).toBe(18_263);
    await svc.updateLine(ctx, project.id, lineId, { unitPriceCents: 25_000 });
    expect(await contingency()).toBe(15_763);
    await svc.deleteLine(ctx, project.id, lineId);
    expect(await contingency()).toBe(13_263);
    await svc.updateRevision(ctx, project.id, revisionId, { contingencyPct: 3.5 });
    const revision = await revisionOf(ctx, project.id);
    expect(revision).toMatchObject({ contingencyBp: 350, totalCents: 265_250 + 9_284 });
    expect(revision.chapters[19]!.lines[0]!.description).toContain("3,5 %");
  });

  it("keeps the twenty chapters: codes fixed, names and notes editable, chapter 20 computed", async () => {
    const { project, ctx } = await setup();
    const { revisionId, c1, chapterId } = await draftBudget(ctx, project.id);
    const computed = (await revisionOf(ctx, project.id)).chapters[19]!.lines[0]!;

    await expect(svc.addChapter(ctx, project.id, revisionId, { code: "21", name: "Otro" })).rejects.toMatchObject({ code: "fixed_chapters", status: 409 });
    await expect(svc.deleteChapter(ctx, project.id, c1)).rejects.toMatchObject({ code: "fixed_chapters" });
    await expect(svc.updateChapter(ctx, project.id, c1, { code: "99" })).rejects.toMatchObject({ code: "fixed_chapters" });
    await expect(svc.addLine(ctx, project.id, chapterId("20"), line("20.02", 1, 1))).rejects.toMatchObject({ code: "fixed_chapters" });
    await expect(svc.updateLine(ctx, project.id, computed.id, { unitPriceCents: 1 })).rejects.toMatchObject({ code: "fixed_chapters" });
    await expect(svc.deleteLine(ctx, project.id, computed.id)).rejects.toMatchObject({ code: "fixed_chapters" });

    await svc.updateChapter(ctx, project.id, c1, { name: "Movimiento de tierras", pdfNote: "Sustituye a…" });
    expect((await revisionOf(ctx, project.id)).chapters[0]).toMatchObject({ name: "Movimiento de tierras", pdfNote: "Sustituye a…" });
  });

  it("moves a line to another chapter of the draft, never into chapter 20 or an option", async () => {
    const { project, ctx } = await setup();
    const { revisionId, chapterId } = await draftBudget(ctx, project.id);
    const [l1] = (await revisionOf(ctx, project.id)).chapters[0]!.lines;
    const { optionId } = await options.addOption(ctx, project.id, revisionId, { name: "Piscina" });

    await svc.updateLine(ctx, project.id, l1!.id, { chapterId: chapterId("04"), code: "04.01" });

    const revision = await revisionOf(ctx, project.id);
    expect(revision.chapters[0]!.lines.map((l) => l.code)).toEqual(["01.02"]);
    expect(revision.chapters[3]!.lines.map((l) => l.code)).toEqual(["04.01"]);
    await expect(svc.updateLine(ctx, project.id, l1!.id, { chapterId: chapterId("20") })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.updateLine(ctx, project.id, l1!.id, { chapterId: optionId })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("takes a line from the price base", async () => {
    const { project, ctx } = await setup();
    const { chapterId } = await draftBudget(ctx, project.id);

    await svc.addLine(ctx, project.id, chapterId("03"), { baseCode: "03.14", quantity: 1 });

    expect((await revisionOf(ctx, project.id)).chapters[2]!.lines[0]).toMatchObject({
      code: "03.14",
      description: "Viga de cumbrera en cajón y pilar interior galvanizado",
      unit: "ud",
      unitPriceCents: 145_588, // the base is at cost: the old 1.732,50 € over 1.19
      source: "base",
      baseCode: "03.14",
    });
    await expect(svc.addLine(ctx, project.id, chapterId("03"), { baseCode: "99.99", quantity: 1 })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("gives a line without a code a free one in its chapter", async () => {
    const { project, ctx } = await setup();
    const { chapterId } = await draftBudget(ctx, project.id);

    // The same price base entry twice, then a line of staff's own.
    await svc.addLine(ctx, project.id, chapterId("03"), { baseCode: "03.14", quantity: 1 });
    await svc.addLine(ctx, project.id, chapterId("03"), { baseCode: "03.14", quantity: 2 });
    await svc.addLine(ctx, project.id, chapterId("03"), { description: "Vierteaguas", unit: "ud", quantity: 1, unitPriceCents: 4_850 });

    expect((await revisionOf(ctx, project.id)).chapters[2]!.lines.map((l) => l.code)).toEqual(["03.14", "03.15", "03.16"]);
  });

  it("takes quantities as entered, never in stored thousandths", async () => {
    const { project, ctx } = await setup();
    const { c1 } = await draftBudget(ctx, project.id);

    const { lineId } = await svc.addLine(ctx, project.id, c1, { ...line("01.09", 2, 100), quantityMilli: 999_999 });
    await expect(svc.addLine(ctx, project.id, c1, { code: "01.10", description: "X", unit: "pa", unitPriceCents: 1, quantityMilli: 1000 })).rejects.toMatchObject({ code: "missing_fields" });
    await svc.updateLine(ctx, project.id, lineId, { quantityMilli: 5 });

    const lines = (await revisionOf(ctx, project.id)).chapters[0]!.lines;
    expect(lines.find((l) => l.id === lineId)).toMatchObject({ quantity: 2, amountCents: 200 });
  });

  it("validates input", async () => {
    const { project, ctx } = await setup();
    const { c1 } = await draftBudget(ctx, project.id);

    await expect(svc.addLine(ctx, project.id, c1, line("01.09", -1, 100))).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.addLine(ctx, project.id, c1, line("01.09", 1, 1.5))).rejects.toMatchObject({ code: "invalid_input" });
    // Only options take negative prices.
    await expect(svc.addLine(ctx, project.id, c1, line("01.09", 1, -100))).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.addLine(ctx, project.id, c1, { code: "01.09" })).rejects.toMatchObject({ code: "missing_fields" });
  });
});

describe("options", () => {
  it("prices options apart, numbering their lines OP.01… across all of them", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);

    const { optionId: pool } = await options.addOption(ctx, project.id, revisionId, { name: "Piscina", optionKind: "extra", intro: "Fuera del PEC" });
    const { optionId: pergola } = await options.addOption(ctx, project.id, revisionId, { name: "Pérgola" });
    await svc.addLine(ctx, project.id, pool, { description: "Vaso", unit: "m³", quantity: 22, unitPriceCents: 42_000 });
    await svc.addLine(ctx, project.id, pergola, { description: "Pérgola", unit: "ud", quantity: 1, unitPriceCents: 742_000 });
    const { lineId } = await svc.addLine(ctx, project.id, pool, { description: "Playa", unit: "m²", quantity: 50, unitPriceCents: 8_600 });

    let revision = await revisionOf(ctx, project.id);
    expect(revision.options.map((o) => [o.code, o.name, o.optionKind, o.totalCents, o.lines.map((l) => l.code)])).toEqual([
      ["OP1", "Piscina", "extra", 924_000 + 430_000, ["OP.01", "OP.02"]],
      ["OP2", "Pérgola", "extra", 742_000, ["OP.03"]],
    ]);
    expect(revision.options[0]!.pdfNote).toBe("Fuera del PEC");
    // The PEC and chapter 20 ignore options.
    expect(revision).toMatchObject({ totalCents: 278_513, contractTotalCents: 278_513 });

    await svc.deleteLine(ctx, project.id, lineId);
    await options.deleteOption(ctx, project.id, pool);
    revision = await revisionOf(ctx, project.id);
    expect(revision.options.map((o) => [o.code, o.lines.map((l) => l.code)])).toEqual([["OP2", ["OP.01"]]]);
    // A new option never reuses a code: hitos map options by code.
    const { optionId } = await options.addOption(ctx, project.id, revisionId, { name: "Cocina" });
    await options.updateOption(ctx, project.id, optionId, { name: "Cocina amueblada", intro: "Partida alzada" });
    expect((await revisionOf(ctx, project.id)).options.map((o) => [o.code, o.name, o.pdfNote])).toEqual([
      ["OP2", "Pérgola", null],
      ["OP3", "Cocina amueblada", "Partida alzada"],
    ]);
  });

  it("never gives a new option the code of a deleted one that a hito closes or an older revision had", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    const { optionId: pool } = await options.addOption(ctx, project.id, revisionId, { name: "Piscina" });
    const [h8] = (await hitosService.listHitos(ctx, project.id)).slice(-2);
    await hitosService.updateHito(ctx, project.id, h8!.id, { chapterCodes: ["OP1"] });

    await options.deleteOption(ctx, project.id, pool);
    await options.addOption(ctx, project.id, revisionId, { name: "Pérgola" });
    expect((await revisionOf(ctx, project.id)).options.map((o) => o.code)).toEqual(["OP2"]);

    // Rev.1 drops OP2: Rev.0 still has it.
    await issue.issueRevision(ctx, project.id, revisionId, { shareWithClient: false });
    const { revisionId: rev1 } = await svc.createRevision(ctx, project.id);
    const [copy] = (await revisionOf(ctx, project.id, rev1)).options;
    await options.deleteOption(ctx, project.id, copy!.id);
    await options.addOption(ctx, project.id, rev1, { name: "Cocina" });
    expect((await revisionOf(ctx, project.id, rev1)).options.map((o) => o.code)).toEqual(["OP3"]);
  });

  it("starts an option from a price base entry", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);

    await options.addOption(ctx, project.id, revisionId, { baseCode: "10.09" });

    expect((await revisionOf(ctx, project.id)).options).toMatchObject([
      { name: "Puerta de garaje seccional motorizada", totalCents: 269_118, lines: [{ code: "OP.01", baseCode: "10.09", source: "base" }] },
    ]);
    await expect(options.addOption(ctx, project.id, revisionId, { baseCode: "nope" })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("offers a line as a deduction or an alternative", async () => {
    const { project, ctx } = await setup();
    await draftBudget(ctx, project.id);
    const [l1, l2] = (await revisionOf(ctx, project.id)).chapters[0]!.lines;

    await options.optionFromLine(ctx, project.id, l1!.id, { kind: "deduction" });
    await options.optionFromLine(ctx, project.id, l2!.id, { kind: "deduction" });
    await options.optionFromLine(ctx, project.id, l2!.id, { kind: "alternative" });

    const [deduction, alternative] = (await revisionOf(ctx, project.id)).options;
    expect(deduction).toMatchObject({ name: "La Propiedad ejecuta", optionKind: "deduction", totalCents: -165_250 });
    expect(deduction!.lines.map((l) => [l.code, l.amountCents, l.note])).toEqual([
      ["OP.01", -92_750, "Deducción de la partida 01.01"],
      ["OP.02", -72_500, "Deducción de la partida 01.02"],
    ]);
    // Replacement (to be priced by staff) and the original at minus its price.
    expect(alternative).toMatchObject({ optionKind: "alternative", replacesLine: "01.02", totalCents: 0 });
    expect(alternative!.lines.map((l) => [l.code, l.amountCents])).toEqual([["OP.03", 72_500], ["OP.04", -72_500]]);
    await expect(options.optionFromLine(ctx, project.id, l1!.id, { kind: "x" })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("doesn't exist on budgets entered before the FRAMER model, whose chapters stay free", async () => {
    const { project, ctx, tenant } = await setup();
    const [legacy] = await db.insert(budgetRevisions).values({ tenantId: tenant.id, projectId: project.id, number: 3 }).returning();

    const { chapterId } = await svc.addChapter(ctx, project.id, legacy!.id, { code: "17", name: "Remates" });
    await svc.addLine(ctx, project.id, chapterId, line("17.01", 1, 1_000));
    await expect(options.addOption(ctx, project.id, legacy!.id, { name: "Piscina" })).rejects.toMatchObject({ code: "fixed_chapters" });

    const revision = await revisionOf(ctx, project.id);
    expect(revision).toMatchObject({ model: null, totalCents: 1_000, checks: [] });
    expect(revision.chapters.map((c) => c.code)).toEqual(["17"]);
    await svc.deleteChapter(ctx, project.id, chapterId);
  });
});

describe("margins", () => {
  /** draftBudget (2.785,13 € at cost) with 13 % gastos asociados and 6 % beneficio industrial. */
  async function withMargins(ctx: Ctx, projectId: string) {
    const draft = await draftBudget(ctx, projectId);
    await svc.updateRevision(ctx, projectId, draft.revisionId, { overheadPct: 13, profitPct: 6 });
    return draft;
  }

  it("takes gastos asociados and beneficio industrial each as a share of the price: the PEC, its chapters and VAT", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await withMargins(ctx, project.id);
    await svc.updateRevision(ctx, project.id, revisionId, { builtAreaM2: 100 });

    const revision = await revisionOf(ctx, project.id);
    // Each unit price is cost ÷ (1 − 0,13 − 0,06) = cost ÷ 0,81, to the cent: 3,50 → 4,32 €,
    // 72,50 → 89,51 €, 1.000 → 1.234,57 € and chapter 20 132,63 → 163,74 €. Of the PEC, 3.438,21 €:
    // 446,97 € of gastos asociados (13 %), 206,29 € of beneficio industrial (6 %), the cost and
    // −0,18 € of the unit prices' rounding.
    expect(revision).toMatchObject({
      costCents: 278_513,
      overheadBp: 1300,
      overheadCents: 44_697,
      profitBp: 600,
      profitCents: 20_629,
      roundingCents: -18,
      totalCents: 343_821,
      contractTotalCents: 343_821,
      vatCents: 34_382,
      perM2Cents: 3_438,
    });
    expect((await svc.getBudget(ctx, project.id)).revisions[0]!.totalCents).toBe(343_821);
    // Each chapter keeps its cost; its price is the sum of its priced lines.
    const [c1, c2] = revision.chapters;
    expect(c1).toMatchObject({ totalCents: 165_250, priceCents: 114_480 + 89_510, perM2Cents: 2_040 });
    expect(c2).toMatchObject({ totalCents: 100_000, priceCents: 123_457 });
    expect(revision.chapters.reduce((sum, c) => sum + c.priceCents, 0)).toBe(343_821);
    // Lines stay at cost.
    expect(c1!.lines.map((l) => l.amountCents)).toEqual([92_750, 72_500]);
  });

  it("prices each option on its own, and the contract with the chosen ones", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await withMargins(ctx, project.id);
    const { optionId: pool } = await options.addOption(ctx, project.id, revisionId, { name: "Piscina" });
    await svc.addLine(ctx, project.id, pool, { description: "Vaso", unit: "ud", quantity: 1, unitPriceCents: 1_000_000 });
    const { optionId: deduction } = await options.addOption(ctx, project.id, revisionId, { name: "Sin cerramiento", optionKind: "deduction" });
    await svc.addLine(ctx, project.id, deduction, { description: "Cerramiento", unit: "ud", quantity: 1, unitPriceCents: -100_000 });

    let revision = await revisionOf(ctx, project.id);
    expect(revision.options.map((o) => [o.totalCents, o.priceCents])).toEqual([
      [1_000_000, 1_234_568],
      [-100_000, -123_457],
    ]);
    expect(revision.optionTotals).toEqual({ adding: { count: 1, cents: 1_234_568 }, subtracting: { count: 1, cents: -123_457 } });

    await issue.issueRevision(ctx, project.id, revisionId, { issuedOn: "2026-10-14", shareWithClient: false });
    await svc.acceptRevision(ctx, project.id, revisionId, { acceptedOn: "2026-10-21", chosenOptionIds: [pool] });

    revision = await revisionOf(ctx, project.id);
    expect(revision.contractTotalCents).toBe(343_821 + 1_234_568);
    // The obra and the hitos follow the price: every line priced, quantity × unit price.
    const obra = await obraService.getObra(ctx, project.id);
    expect(obra.budget!.totalCents).toBe(1_578_389);
    expect(obra.chapters.find((c) => c.code === "01")!.totalCents).toBe(203_990);
    expect(obra.chapters.reduce((sum, c) => sum + c.totalCents, 0)).toBe(1_578_389);
    expect((await hitosService.listHitos(ctx, project.id))[0]).toMatchObject({ amountCents: 78_919 });
    const chapter = await obraService.getChapter(ctx, project.id, "01");
    expect(chapter.chapter.lines.map((l) => [l.amountCents, l.unitPriceCents])).toEqual([
      [265 * 432, 432],
      [10 * 8_951, 8_951],
    ]);
  });

  it("takes them in % on a draft only, and a new revision keeps them", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await withMargins(ctx, project.id);

    await svc.updateRevision(ctx, project.id, revisionId, { overheadPct: 12.5, profitPct: 0 });
    expect(await revisionOf(ctx, project.id)).toMatchObject({ overheadBp: 1250, profitBp: 0, profitCents: 0 });
    for (const bad of [-1, 101, "13", null]) {
      await expect(svc.updateRevision(ctx, project.id, revisionId, { overheadPct: bad })).rejects.toMatchObject({ code: "invalid_input" });
      await expect(svc.updateRevision(ctx, project.id, revisionId, { profitPct: bad })).rejects.toMatchObject({ code: "invalid_input" });
    }
    // Beneficio is a margin on the price: up to 50 %, never the whole price.
    await expect(svc.updateRevision(ctx, project.id, revisionId, { profitPct: 51 })).rejects.toMatchObject({ code: "invalid_input" });

    await issue.issueRevision(ctx, project.id, revisionId, { shareWithClient: false });
    await expect(svc.updateRevision(ctx, project.id, revisionId, { profitPct: 6 })).rejects.toMatchObject({ code: "not_draft" });
    await svc.createRevision(ctx, project.id);
    expect(await revisionOf(ctx, project.id)).toMatchObject({ number: 1, overheadBp: 1250, profitBp: 0 });
  });

  it("keeps them to their tenant and away from viewers", async () => {
    const { tenant, project, ctx } = await setup();
    const { revisionId } = await withMargins(ctx, project.id);
    const other = await setup();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });

    await expect(svc.updateRevision(other.ctx, project.id, revisionId, { profitPct: 50 })).rejects.toMatchObject({ code: "project_not_found" });
    await expect(svc.updateRevision(other.ctx, other.project.id, revisionId, { profitPct: 50 })).rejects.toMatchObject({ code: "not_found" });
    await expect(
      svc.updateRevision({ tenantId: tenant.id, userId: viewer.id, role: "viewer" }, project.id, revisionId, { profitPct: 50 }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect((await revisionOf(ctx, project.id)).profitBp).toBe(600);
  });
});

describe("a project deleted meanwhile", () => {
  it("is not found by the lock a new revision takes, so none lands on it", async () => {
    const { project, ctx } = await setup();
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, project.id));

    const locked = db.transaction((tx) => lockProject(tx, project.id));
    await expect(locked).rejects.toMatchObject({ code: "project_not_found" });
    // Through the service it is refused earlier, by the project lookup.
    await expect(svc.createBudget(ctx, project.id, {})).rejects.toMatchObject({ code: "project_not_found" });
    expect(await db.select().from(budgetRevisions).where(eq(budgetRevisions.projectId, project.id))).toEqual([]);
  });
});

describe("issuing and accepting", () => {
  it("issues a draft: freezes it and stores its two PDFs, the general one for the client", async () => {
    const { tenant, client, project, ctx } = await setup();
    const { revisionId, c1 } = await draftBudget(ctx, project.id);
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-14T10:00:00Z") });

    await issue.issueRevision(ctx, project.id, revisionId);

    const revision = await revisionOf(ctx, project.id);
    expect(revision).toMatchObject({ status: "issued", issuedOn: "2026-10-14", validUntil: "2027-01-12" });
    const docs = await documentsService.listDocuments(ctx, project.id);
    expect(docs.map((d) => [d.title, d.budgetPdf, d.visibleToClient])).toEqual(
      expect.arrayContaining([
        ["Presupuesto 036/2026 · Rev.0 · general", "general", true],
        ["Presupuesto 036/2026 · Rev.0 · detallado", "detailed", false],
      ]),
    );
    expect(revision.pdfs.general).toBe(docs.find((d) => d.budgetPdf === "general")!.id);
    expect((await documentsService.listClientDocuments(tenant.id, client.id)).map((d) => d.title)).toEqual(["Presupuesto 036/2026 · Rev.0 · general"]);
    // Stored files are real PDFs; what was sent can't change or be deleted.
    const stored = files.get([...files.keys()][0]!)!;
    expect(await stored.slice(0, 5).text()).toBe("%PDF-");
    await expect(svc.addLine(ctx, project.id, c1, line("01.03", 1, 1))).rejects.toMatchObject({ code: "not_draft" });
    await expect(issue.issueRevision(ctx, project.id, revisionId)).rejects.toMatchObject({ code: "not_draft" });
    await expect(documentsService.deleteDocument(ctx, project.id, revision.pdfs.general!)).rejects.toMatchObject({ code: "budget_document" });
  });

  it("stays a draft when its PDFs can't be stored, and can be issued again", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    vi.spyOn(storage, "putFile").mockRejectedValueOnce(new Error("store down"));

    await expect(issue.issueRevision(ctx, project.id, revisionId)).rejects.toThrow("store down");
    expect((await revisionOf(ctx, project.id)).status).toBe("draft");
    expect(files.size).toBe(0);

    await issue.issueRevision(ctx, project.id, revisionId);
    expect(await revisionOf(ctx, project.id)).toMatchObject({ status: "issued", pdfs: { general: expect.any(String), detailed: expect.any(String) } });
  });

  it("needs the reason for the change from Rev.1 on", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    await issue.issueRevision(ctx, project.id, revisionId, { shareWithClient: false });
    const { revisionId: rev1 } = await svc.createRevision(ctx, project.id);

    await expect(issue.issueRevision(ctx, project.id, rev1)).rejects.toMatchObject({ code: "change_reason_required", status: 400 });
    await svc.updateRevision(ctx, project.id, rev1, { changeReason: "Mediciones del BC3" });
    await issue.issueRevision(ctx, project.id, rev1, { issuedOn: "2026-11-02", validUntil: "2026-12-31" });

    expect(await revisionOf(ctx, project.id, rev1)).toMatchObject({ status: "issued", changeReason: "Mediciones del BC3", validUntil: "2026-12-31" });
  });

  it("accepts an issued revision with the options the client chose: the contract and its hitos follow", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    const { optionId: pool } = await options.addOption(ctx, project.id, revisionId, { name: "Piscina" });
    const { optionId: kitchen } = await options.addOption(ctx, project.id, revisionId, { name: "Cocina" });
    await svc.addLine(ctx, project.id, pool, { description: "Vaso", unit: "ud", quantity: 1, unitPriceCents: 1_000_000 });
    await svc.addLine(ctx, project.id, kitchen, { description: "Cocina", unit: "pa", quantity: 1, unitPriceCents: 500_000 });
    await issue.issueRevision(ctx, project.id, revisionId, { issuedOn: "2026-10-14" });

    await svc.acceptRevision(ctx, project.id, revisionId, { acceptedOn: "2026-10-21", acceptedBy: "D. Roberto Guzmán", chosenOptionIds: [pool] });

    const revision = await revisionOf(ctx, project.id);
    expect(revision).toMatchObject({ status: "accepted", acceptedOn: "2026-10-21", acceptedBy: "D. Roberto Guzmán", totalCents: 278_513, contractTotalCents: 1_278_513 });
    // No signed copy was handed in.
    expect(revision.signedDocumentId).toBeNull();
    expect(revision.options.map((o) => [o.name, o.chosen])).toEqual([["Piscina", true], ["Cocina", false]]);
    // H0 is 5 % of the contract: PEC plus the pool.
    expect((await hitosService.listHitos(ctx, project.id))[0]).toMatchObject({ amountCents: 63_926 });
    await expect(svc.acceptRevision(ctx, project.id, revisionId)).rejects.toMatchObject({ code: "not_issued" });
  });

  it("files the client's signed copy with the contracts, checking it before accepting", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    await issue.issueRevision(ctx, project.id, revisionId, { shareWithClient: false });

    const notPdf = new Blob(["hola"], { type: "application/pdf" });
    await expect(svc.acceptRevision(ctx, project.id, revisionId, { signed: notPdf })).rejects.toMatchObject({ code: "invalid_file_type" });
    expect((await revisionOf(ctx, project.id)).status).toBe("issued");

    await svc.acceptRevision(ctx, project.id, revisionId, { signed: new Blob(["%PDF-1.7 firmado"]) });

    const accepted = await revisionOf(ctx, project.id);
    expect(accepted.status).toBe("accepted");
    const docs = await documentsService.listDocuments(ctx, project.id);
    const contract = docs.find((d) => d.category === "contract")!;
    expect(contract).toMatchObject({ title: "Presupuesto 036/2026 · Rev.0 · firmado" });
    // The revision points at its signed copy, which is its proof: it can't be deleted.
    expect(accepted.signedDocumentId).toBe(contract.id);
    await expect(documentsService.deleteDocument(ctx, project.id, contract.id)).rejects.toMatchObject({ code: "budget_document" });
    expect(await revisionOf(ctx, project.id)).toMatchObject({ status: "accepted", signedDocumentId: contract.id });
  });

  it("can't be issued on a day still to come", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-20T10:00:00Z") });
    await expect(issue.issueRevision(ctx, project.id, revisionId, { issuedOn: "2026-10-21" })).rejects.toMatchObject({ code: "invalid_date" });
    expect(await revisionOf(ctx, project.id)).toMatchObject({ status: "draft" });
  });

  it("records who registered the acceptance: the staff user, not the name typed for the client", async () => {
    const { tenant, project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    await issue.issueRevision(ctx, project.id, revisionId, { shareWithClient: false });
    const admin = await createTestUser(tenant.id, { role: "admin", name: "Marta Ruiz" });

    await svc.acceptRevision({ tenantId: tenant.id, userId: admin.id, role: "admin" }, project.id, revisionId, { acceptedBy: "D. Roberto Guzmán" });

    const [row] = await db.select().from(budgetRevisions).where(eq(budgetRevisions.id, revisionId));
    expect(row).toMatchObject({ acceptedByUserId: admin.id, acceptedBy: "D. Roberto Guzmán", acceptedDocumentId: null });
    expect(await revisionOf(ctx, project.id)).toMatchObject({
      acceptedBy: "D. Roberto Guzmán",
      acceptedByUser: { id: admin.id, name: "Marta Ruiz" },
      acceptedAt: expect.any(String),
    });
  });

  it("shows no registrar on a revision accepted before it was kept", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    await svc.acceptRevision(ctx, project.id, revisionId, {}, { unissued: true });
    await db.update(budgetRevisions).set({ acceptedByUserId: null }).where(eq(budgetRevisions.id, revisionId));

    expect(await revisionOf(ctx, project.id)).toMatchObject({ status: "accepted", acceptedByUser: null, signedDocumentId: null });
  });

  it("takes the day the client accepted between the issue and today", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-20T10:00:00Z") });
    await issue.issueRevision(ctx, project.id, revisionId, { issuedOn: "2026-10-14", shareWithClient: false });

    // Tomorrow, the day before it was sent, and no date at all.
    for (const acceptedOn of ["2026-10-21", "2026-10-13", "2026-02-30", null]) {
      await expect(svc.acceptRevision(ctx, project.id, revisionId, { acceptedOn })).rejects.toMatchObject({ code: "invalid_date", status: 400 });
    }
    expect(await revisionOf(ctx, project.id)).toMatchObject({ status: "issued", acceptedOn: null, acceptedByUser: null });

    // The day it was sent is fine; without a date it is today.
    await svc.acceptRevision(ctx, project.id, revisionId, { acceptedOn: "2026-10-14" });
    expect(await revisionOf(ctx, project.id)).toMatchObject({ status: "accepted", acceptedOn: "2026-10-14" });

    const { revisionId: rev1 } = await svc.createRevision(ctx, project.id);
    await svc.updateRevision(ctx, project.id, rev1, { changeReason: "Cambio de carpintería" });
    await issue.issueRevision(ctx, project.id, rev1, { shareWithClient: false });
    await svc.acceptRevision(ctx, project.id, rev1);
    expect(await revisionOf(ctx, project.id, rev1)).toMatchObject({ status: "accepted", acceptedOn: "2026-10-20" });
  });

  it("stays issued when the signed copy can't be stored, so the acceptance can be sent again", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    await issue.issueRevision(ctx, project.id, revisionId, { shareWithClient: false });
    vi.spyOn(storage, "putFile").mockRejectedValueOnce(new Error("store down"));
    const signed = new Blob(["%PDF-1.7 firmado"]);

    await expect(svc.acceptRevision(ctx, project.id, revisionId, { signed })).rejects.toThrow("store down");
    expect((await revisionOf(ctx, project.id)).status).toBe("issued");

    await svc.acceptRevision(ctx, project.id, revisionId, { signed });
    expect((await revisionOf(ctx, project.id)).status).toBe("accepted");
    expect((await documentsService.listDocuments(ctx, project.id)).filter((d) => d.category === "contract")).toHaveLength(1);
  });

  it("refuses options from another revision", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    await issue.issueRevision(ctx, project.id, revisionId, { shareWithClient: false });
    await expect(svc.acceptRevision(ctx, project.id, revisionId, { chosenOptionIds: ["nope"] })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.acceptRevision(ctx, project.id, revisionId, { chosenOptionIds: "x" })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("records a rejection, after which a new revision starts from it", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    await expect(svc.rejectRevision(ctx, project.id, revisionId)).rejects.toMatchObject({ code: "not_issued" });
    await issue.issueRevision(ctx, project.id, revisionId, { shareWithClient: false });

    await svc.rejectRevision(ctx, project.id, revisionId, { rejectedOn: "2026-10-22" });
    expect(await revisionOf(ctx, project.id)).toMatchObject({ status: "rejected", rejectedOn: "2026-10-22" });
    await expect(svc.acceptRevision(ctx, project.id, revisionId)).rejects.toMatchObject({ code: "not_issued" });

    const { revisionId: rev1 } = await svc.createRevision(ctx, project.id);
    await svc.acceptRevision(ctx, project.id, rev1, {}, { unissued: true });
    const budget = await svc.getBudget(ctx, project.id);
    expect(budget.revisions.map((r) => [r.number, r.status])).toEqual([[1, "accepted"], [0, "superseded"]]);
  });

  it("refuses a draft: what the client was never sent can't be the contract", async () => {
    const { project, ctx } = await setup();
    const { revisionId, c1 } = await draftBudget(ctx, project.id);

    await expect(svc.acceptRevision(ctx, project.id, revisionId)).rejects.toMatchObject({ code: "not_issued", status: 409 });
    await expect(svc.acceptRevision(ctx, project.id, revisionId, { acceptedBy: "Ana" }, { unissued: false })).rejects.toMatchObject({ code: "not_issued" });
    // Nothing a caller sends opens the way round: only core's own option does.
    await expect(svc.acceptRevision(ctx, project.id, revisionId, { unissued: true })).rejects.toMatchObject({ code: "not_issued" });

    expect(await revisionOf(ctx, project.id)).toMatchObject({ status: "draft", acceptedAt: null, acceptedOn: null, acceptedBy: null, acceptedByUser: null });
    // Still a draft in every way: it can be edited, and the obra has no contract.
    await svc.addLine(ctx, project.id, c1, line("01.03", 1, 1));
    expect((await obraService.getObra(ctx, project.id)).budget).toBeNull();
  });

  it("accepts a draft only as a contract signed outside the platform (`unissued`)", async () => {
    const { project, ctx } = await setup();
    const { revisionId, c1 } = await draftBudget(ctx, project.id);
    await svc.acceptRevision(ctx, project.id, revisionId, { acceptedOn: "2026-01-15" }, { unissued: true });

    await expect(svc.addLine(ctx, project.id, c1, line("01.03", 1, 1))).rejects.toMatchObject({ code: "not_draft", status: 409 });
    const [l1, l2] = (await revisionOf(ctx, project.id)).chapters[0]!.lines;
    await svc.setProgress(ctx, project.id, { lines: [{ id: l1!.id, executedPct: 100 }, { id: l2!.id, executedPct: 50 }] });

    const revision = await revisionOf(ctx, project.id);
    expect(revision).toMatchObject({ status: "accepted", acceptedAt: expect.any(String), acceptedOn: "2026-01-15", issuedOn: null, acceptedByUser: { id: ctx.userId } });
    expect(revision.chapters[0]).toMatchObject({ executedCents: 92_750 + 36_250, progressPct: 78, status: "active" });
  });

  it("records progress only on the accepted revision, within 0–100", async () => {
    const { project, ctx } = await setup();
    await draftBudget(ctx, project.id);
    const lineId = (await revisionOf(ctx, project.id)).chapters[0]!.lines[0]!.id;

    await expect(svc.setProgress(ctx, project.id, { lines: [{ id: lineId, executedPct: 10 }] })).rejects.toMatchObject({ code: "not_accepted" });
    await svc.acceptRevision(ctx, project.id, (await revisionOf(ctx, project.id)).id, {}, { unissued: true });
    await expect(svc.setProgress(ctx, project.id, { lines: [{ id: lineId, executedPct: 101 }] })).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("revisions", () => {
  it("copies the newest revision into a new draft, options and texts included, and compares them", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    const { optionId } = await options.addOption(ctx, project.id, revisionId, { name: "Piscina" });
    await svc.addLine(ctx, project.id, optionId, { description: "Vaso", unit: "ud", quantity: 1, unitPriceCents: 1_000 });
    await svc.updateRevision(ctx, project.id, revisionId, { texts: { measurementCriterion: "Sobre planos" }, contingencyPct: 4 });
    await issue.issueRevision(ctx, project.id, revisionId, { shareWithClient: false });
    await svc.acceptRevision(ctx, project.id, revisionId, { chosenOptionIds: [optionId] });

    const { revisionId: rev1 } = await svc.createRevision(ctx, project.id);
    const draft = await revisionOf(ctx, project.id, rev1);
    expect(draft).toMatchObject({ number: 1, status: "draft", contingencyBp: 400, changeReason: null, previous: { number: 0, totalCents: 275_860 } });
    expect(draft.texts.measurementCriterion).toBe("Sobre planos");
    // The client chooses afresh.
    expect(draft.options).toMatchObject([{ code: "OP1", chosen: null, totalCents: 1_000 }]);
    expect(draft.chapters.slice(0, 2).map((c) => [c.code, c.change])).toEqual([["01", null], ["02", null]]);

    await svc.addLine(ctx, project.id, draft.chapters[0]!.id, line("01.03", 1, 1_000));
    await svc.updateLine(ctx, project.id, draft.chapters[1]!.lines[0]!.id, { unitPriceCents: 50_000 });
    const compared = await revisionOf(ctx, project.id, rev1);
    expect(compared.chapters.slice(0, 3).map((c) => [c.code, c.change, c.previousTotalCents])).toEqual([
      ["01", "up", 165_250],
      ["02", "down", 100_000],
      ["03", null, 0],
    ]);
    expect(compared.lineChanges).toEqual([
      { code: "01.03", description: "Partida 01.03", kind: "added", before: null, after: { quantity: 1, unitPriceCents: 1_000, amountCents: 1_000 } },
      { code: "02.01", description: "Partida 02.01", kind: "changed", before: { quantity: 1, unitPriceCents: 100_000, amountCents: 100_000 }, after: { quantity: 1, unitPriceCents: 50_000, amountCents: 50_000 } },
    ]);
    // The original revision is untouched; one draft at a time.
    expect((await revisionOf(ctx, project.id, revisionId)).chapters[1]!.totalCents).toBe(100_000);
    await expect(svc.createRevision(ctx, project.id)).rejects.toMatchObject({ code: "draft_exists" });
  });

  it("follows option lines across revisions when their OP numbers shift", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    const first = await options.addOption(ctx, project.id, revisionId, { name: "Piscina" });
    const second = await options.addOption(ctx, project.id, revisionId, { name: "Pérgola" });
    await svc.addLine(ctx, project.id, first.optionId, { description: "Vaso", unit: "ud", quantity: 1, unitPriceCents: 1_000 });
    await svc.addLine(ctx, project.id, second.optionId, { description: "Estructura", unit: "ud", quantity: 1, unitPriceCents: 2_000 });
    await issue.issueRevision(ctx, project.id, revisionId, { shareWithClient: false });
    const { revisionId: rev1 } = await svc.createRevision(ctx, project.id);

    // Removing OP.01 renumbers the pergola's line from OP.02 to OP.01.
    const copy = await revisionOf(ctx, project.id, rev1);
    await svc.deleteLine(ctx, project.id, copy.options[0]!.lines[0]!.id);

    const compared = await revisionOf(ctx, project.id, rev1);
    expect(compared.options[1]!.lines.map((l) => l.code)).toEqual(["OP.01"]);
    expect(compared.lineChanges).toEqual([
      { code: "OP.01", description: "Vaso", kind: "removed", before: { quantity: 1, unitPriceCents: 1_000, amountCents: 1_000 }, after: null },
    ]);
  });

  it("supersedes the accepted revision and keeps the progress recorded on it", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    await svc.acceptRevision(ctx, project.id, revisionId, {}, { unissued: true });
    const { revisionId: rev1 } = await svc.createRevision(ctx, project.id);
    // Progress recorded after the draft was copied still carries over.
    const accepted = await revisionOf(ctx, project.id, revisionId);
    await svc.setProgress(ctx, project.id, { lines: [{ id: accepted.chapters[0]!.lines[0]!.id, executedPct: 80 }] });

    await svc.acceptRevision(ctx, project.id, rev1, {}, { unissued: true });

    const budget = await svc.getBudget(ctx, project.id);
    expect(budget.revisions.map((r) => [r.number, r.status])).toEqual([[1, "accepted"], [0, "superseded"]]);
    expect(budget.revision!.chapters[0]!.lines[0]!.executedPct).toBe(80);
  });

  it("refuses a draft edit that races the draft being issued or accepted", async () => {
    const { project, ctx } = await setup();
    const { revisionId, c2 } = await draftBudget(ctx, project.id);
    const [target] = await db.select().from(budgetLines).where(eq(budgetLines.chapterId, c2));
    // Another request freezes the draft: it holds the revision's row, not yet committed.
    let commit!: () => void;
    let frozen!: () => void;
    const isFrozen = new Promise<void>((resolve) => (frozen = resolve));
    const freezing = db.transaction(async (tx) => {
      await tx.update(budgetRevisions).set({ status: "issued" }).where(eq(budgetRevisions.id, revisionId));
      frozen();
      await new Promise<void>((resolve) => (commit = resolve));
    });
    await isFrozen;

    // The edit's checks still see a draft; its write waits for the lock, then sees it frozen.
    const edit = svc.updateLine(ctx, project.id, target!.id, { description: "Changed" }).catch((e) => e);
    await new Promise((resolve) => setTimeout(resolve, 200));
    commit();
    await freezing;

    expect(await edit).toMatchObject({ code: "not_draft" });
    const [after] = await db.select().from(budgetLines).where(eq(budgetLines.id, target!.id));
    expect(after!.description).toBe(target!.description);
  });

  it("deletes a draft revision only", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    await svc.acceptRevision(ctx, project.id, revisionId, {}, { unissued: true });
    await expect(svc.deleteRevision(ctx, project.id, revisionId)).rejects.toMatchObject({ code: "not_draft" });

    const { revisionId: rev1 } = await svc.createRevision(ctx, project.id);
    await svc.deleteRevision(ctx, project.id, rev1);
    expect((await svc.getBudget(ctx, project.id)).revisions).toHaveLength(1);
    expect(await db.select().from(budgetChapters).where(eq(budgetChapters.revisionId, rev1))).toEqual([]);
  });

  it("updates a draft's details, texts and conditions", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);

    await svc.updateRevision(ctx, project.id, revisionId, {
      reference: "037/2026",
      vatRateBp: 2100,
      builtAreaM2: 253.45,
      usefulAreaM2: 208.25,
      quality: "project",
      texts: {
        cover: { promoter: "D. Roberto Guzmán Mesa" },
        justification: { blocks: [{ title: "Estructura", text: "Steel Frame" }] },
        exclusions: ["Geotécnico", " ", "Mobiliario "],
      },
      conditions: { validityDays: 60, signingPlace: "Zarzalejo" },
    });

    const revision = await revisionOf(ctx, project.id);
    expect(revision).toMatchObject({
      reference: "037/2026",
      vatRateBp: 2100,
      vatCents: 58_488,
      builtAreaM2: 253.45,
      usefulAreaM2: 208.25,
      quality: "project",
      exclusions: ["Geotécnico", "Mobiliario"],
      conditions: { validityDays: 60, signingPlace: "Zarzalejo" },
    });
    // The site is the project's address, from the start.
    expect(revision.texts.cover).toMatchObject({ promoter: "D. Roberto Guzmán Mesa", site: "Calle Mayor 1, Santander" });
    expect(revision.texts.justification.blocks).toEqual([{ title: "Estructura", text: "Steel Frame" }]);
    // The intro keeps its default: sections merge, fields within them are replaced.
    expect(revision.texts.justification.intro).toContain("FRAMER Steel Frame");
    await expect(svc.updateRevision(ctx, project.id, revisionId, { texts: { annex: [{ kind: "rumour", title: "", text: "" }] } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.updateRevision(ctx, project.id, revisionId, { quality: "luxury" })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("has no delay penalty: one stored or sent before is never read, kept or printed", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    const stored = async () => (await db.select({ conditions: budgetRevisions.conditions }).from(budgetRevisions).where(eq(budgetRevisions.id, revisionId)))[0]!.conditions;
    expect(await stored()).toEqual({ validityDays: 90, term: expect.any(String), signingPlace: "" });

    // A row written while the conditions had one.
    await db.update(budgetRevisions).set({ conditions: { validityDays: 45, term: "9 meses", penalty: "150 €/día", signingPlace: "Zarzalejo" } }).where(eq(budgetRevisions.id, revisionId));
    expect((await revisionOf(ctx, project.id)).conditions).toEqual({ validityDays: 45, term: "9 meses", signingPlace: "Zarzalejo" });

    // An older client still sending it: dropped, not refused, and the next write leaves the row without it.
    await svc.updateRevision(ctx, project.id, revisionId, { conditions: { term: "10 meses", penalty: "200 €/día" } as never });
    expect(await stored()).toEqual({ validityDays: 45, term: "10 meses", signingPlace: "Zarzalejo" });

    // A new revision copies the conditions as read, not as stored.
    await db.update(budgetRevisions).set({ conditions: { validityDays: 45, term: "10 meses", penalty: "150 €/día", signingPlace: "Zarzalejo" } }).where(eq(budgetRevisions.id, revisionId));
    await svc.acceptRevision(ctx, project.id, revisionId, {}, { unissued: true });
    const { revisionId: copy } = await svc.createRevision(ctx, project.id);
    const [copied] = await db.select({ conditions: budgetRevisions.conditions }).from(budgetRevisions).where(eq(budgetRevisions.id, copy));
    expect(copied!.conditions).toEqual({ validityDays: 45, term: "10 meses", signingPlace: "Zarzalejo" });

    // The contract: 15 clauses, and what the PDF fills them with leaves no placeholder behind.
    const letterhead = { name: "Framer", tagline: "", address: "", phone: "", jurisdiction: "", mediator: "" };
    const values = contractValues(await revisionOf(ctx, project.id), letterhead, "Calle Mayor 1, Santander");
    expect(values).not.toHaveProperty("penalty");
    const contract = [CONTRACT_INTRO, ...CONTRACT_CLAUSES.flatMap((c) => [c.title, c.text])].join("\n");
    expect(CONTRACT_CLAUSES).toHaveLength(15);
    expect(contract).not.toMatch(/penaliz/i);
    expect(fill(contract, values)).not.toMatch(/[{}]/);
    // The clause the first one points at is still the measurements'.
    expect(CONTRACT_CLAUSES[0]!.text).toContain("conforme a la Cláusula 4ª");
    expect(CONTRACT_CLAUSES[3]!.title).toMatch(/^Liquidación por Mediciones Reales/);
  });
});

describe("the v1 exclusions field", () => {
  it("lands in a FRAMER revision's texts, one per line", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);

    await svc.updateRevision(ctx, project.id, revisionId, { exclusions: "Licencia de obra\n\nMobiliario " });

    const revision = await revisionOf(ctx, project.id);
    expect(revision.texts.exclusions).toEqual(["Licencia de obra", "Mobiliario"]);
    expect(revision.exclusions).toEqual(["Licencia de obra", "Mobiliario"]);
  });
});

describe("checks before issuing", () => {
  it("lists the AI's inconsistencies and assumptions, estimated lines and chapters off the tenant's ratios", async () => {
    const { tenant, project, ctx } = await setup();
    // Another project's issued budget: 01 at 100 €/m² built, at price (77 € of
    // cost ÷ (1 − 0,15 − 0,08); budgets compare at what the client pays).
    const reference = await createTestProject(tenant.id);
    const { revisionId: refRev, chapterId: refChapter } = await framerDraft(ctx, reference.id, [], 0, { overheadPct: 15, profitPct: 8 });
    await svc.addLine(ctx, reference.id, refChapter("01"), line("01.01", 100, 7_700));
    await svc.updateRevision(ctx, reference.id, refRev, { builtAreaM2: 100 });
    await issue.issueRevision(ctx, reference.id, refRev, { shareWithClient: false });

    const { revisionId, chapterId } = await framerDraft(ctx, project.id, []);
    await svc.addLine(ctx, project.id, chapterId("01"), line("01.01", 100, 20_000)); // 200 €/m²
    await svc.addLine(ctx, project.id, chapterId("03"), { ...line("03.91", 1, 5_000), source: "estimated", note: "Precio de mercado" });
    await svc.updateRevision(ctx, project.id, revisionId, {
      builtAreaM2: 100,
      texts: {
        annex: [
          { id: "i1", kind: "inconsistency", title: "Carga de nieve", text: "E1 frente a E4" },
          { id: "s1", kind: "assumption", title: "Parcela", text: "Sin superficie" },
          { id: "n1", kind: "note", title: "Sauna", text: "Confirmar" },
        ],
      },
    });

    let checks = (await revisionOf(ctx, project.id)).checks;
    const estimated = `line:${(await revisionOf(ctx, project.id)).chapters[2]!.lines[0]!.lineageId}`;
    expect(checks.map((c) => [c.key, c.kind, c.chapterCode, c.done])).toEqual([
      ["annex:i1", "inconsistency", null, false],
      ["annex:s1", "assumption", null, false],
      [estimated, "estimated", "03", false],
      ["ratio:01", "ratio", "01", false],
    ]);
    expect(checks[3]).toMatchObject({ perM2Cents: 20_000, averageCents: 10_000, ref: "01" });

    await svc.updateRevision(ctx, project.id, revisionId, { review: { done: ["annex:i1", estimated] } });
    checks = (await revisionOf(ctx, project.id)).checks;
    expect(checks.filter((c) => c.done).map((c) => c.key)).toEqual(["annex:i1", estimated]);
    // One check at a time, merged with what is stored: the others stay ticked.
    await Promise.all([
      svc.updateRevision(ctx, project.id, revisionId, { reviewed: { key: "annex:s1", done: true } }),
      svc.updateRevision(ctx, project.id, revisionId, { reviewed: { key: "ratio:01", done: true } }),
    ]);
    await svc.updateRevision(ctx, project.id, revisionId, { reviewed: { key: "annex:i1", done: false } });
    checks = (await revisionOf(ctx, project.id)).checks;
    expect(checks.filter((c) => c.done).map((c) => c.key)).toEqual(["annex:s1", estimated, "ratio:01"]);
    // A key whose check is gone for now is kept, for when it comes back.
    await svc.updateRevision(ctx, project.id, revisionId, { reviewed: { key: "ratio:02", done: true } });
    await svc.updateRevision(ctx, project.id, revisionId, { reviewed: { key: "annex:i1", done: true } });
    const [stored] = await db.select({ review: budgetRevisions.review }).from(budgetRevisions).where(eq(budgetRevisions.id, revisionId));
    expect((stored!.review as { done: string[] }).done.slice().sort()).toEqual(["annex:i1", "annex:s1", estimated, "ratio:01", "ratio:02"].sort());
    for (const reviewed of [{ key: "annex:i1" }, { key: "", done: true }, { key: "x".repeat(81), done: true }, null]) {
      await expect(svc.updateRevision(ctx, project.id, revisionId, { reviewed })).rejects.toMatchObject({ code: "invalid_input" });
    }
    // Capped, so the stored list can't grow without end.
    const full = Array.from({ length: 1_000 }, (_, i) => `annex:x${i}`);
    await svc.updateRevision(ctx, project.id, revisionId, { review: { done: full } });
    await expect(svc.updateRevision(ctx, project.id, revisionId, { reviewed: { key: "annex:i1", done: true } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.updateRevision(ctx, project.id, revisionId, { review: { done: [...full, "annex:i1"] } })).rejects.toMatchObject({ code: "invalid_input" });
    await svc.updateRevision(ctx, project.id, revisionId, { review: { done: ["annex:i1", estimated] } });

    // A new revision keeps what was ticked: the line is the same line.
    await issue.issueRevision(ctx, project.id, revisionId, { shareWithClient: false });
    await expect(svc.updateRevision(ctx, project.id, revisionId, { reviewed: { key: "annex:i1", done: false } })).rejects.toMatchObject({ code: "not_draft" });
    await svc.createRevision(ctx, project.id);
    expect((await revisionOf(ctx, project.id)).checks.find((c) => c.kind === "estimated")!.key).toBe(estimated);
  });
});

describe("PDFs", () => {
  it("renders a draft's PDF on the fly and serves an issued revision's stored one", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    const viewer = { ...ctx, role: "viewer" as const };

    const draft = await issue.revisionPdf(viewer, project.id, revisionId, "detailed");
    expect(draft).toMatchObject({ contentType: "application/pdf", filename: "Presupuesto 036/2026 · Rev.0 · detallado.pdf" });
    expect((await new Response(draft.body).text()).slice(0, 5)).toBe("%PDF-");

    await issue.issueRevision(ctx, project.id, revisionId);
    const stored = (await revisionOf(ctx, project.id)).pdfs.general!;
    const served = await issue.revisionPdf(viewer, project.id, revisionId, "general");
    const [file] = await documentsService.listDocuments(ctx, project.id).then((docs) => docs.filter((d) => d.id === stored));
    expect(served.sizeBytes).toBe(file!.sizeBytes);
  });
});

describe("access", () => {
  it("lets viewers read but not change", async () => {
    const { tenant, project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    const vctx: Ctx = { tenantId: tenant.id, userId: viewer.id, role: "viewer" };

    expect((await revisionOf(vctx, project.id)).chapters).toHaveLength(20);
    await expect(svc.createRevision(vctx, project.id)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(options.addOption(vctx, project.id, revisionId, { name: "X" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(issue.issueRevision(vctx, project.id, revisionId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.acceptRevision(vctx, project.id, revisionId)).rejects.toMatchObject({ code: "forbidden" });
    // Issued or not, and whatever they pass.
    await issue.issueRevision(ctx, project.id, revisionId, { shareWithClient: false });
    await expect(svc.acceptRevision(vctx, project.id, revisionId)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(svc.acceptRevision(vctx, project.id, revisionId, {}, { unissued: true })).rejects.toMatchObject({ code: "forbidden" });
    expect((await revisionOf(ctx, project.id)).status).toBe("issued");
  });

  it("keeps tenants apart", async () => {
    const { project, ctx } = await setup();
    const { revisionId, c1 } = await draftBudget(ctx, project.id);
    const other = await setup();
    const [row] = await db.select().from(budgetLines).where(eq(budgetLines.chapterId, c1));

    await expect(svc.getBudget(other.ctx, project.id)).rejects.toMatchObject({ code: "project_not_found" });
    await expect(svc.updateChapter(other.ctx, project.id, c1, { name: "X" })).rejects.toMatchObject({ code: "project_not_found" });
    // Its own project, someone else's rows.
    await expect(svc.updateLine(other.ctx, other.project.id, row!.id, { quantity: 1 })).rejects.toMatchObject({ code: "not_found" });
    await expect(options.addOption(other.ctx, other.project.id, revisionId, { name: "X" })).rejects.toMatchObject({ code: "not_found" });
    await expect(options.optionFromLine(other.ctx, other.project.id, row!.id, { kind: "deduction" })).rejects.toMatchObject({ code: "not_found" });
    await expect(issue.issueRevision(other.ctx, other.project.id, revisionId)).rejects.toMatchObject({ code: "not_found" });
    await expect(issue.revisionPdf(other.ctx, other.project.id, revisionId, "general")).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.acceptRevision(other.ctx, other.project.id, revisionId)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.rejectRevision(other.ctx, other.project.id, revisionId)).rejects.toMatchObject({ code: "not_found" });
    // The same once it is issued, by its own project too.
    await issue.issueRevision(ctx, project.id, revisionId, { shareWithClient: false });
    await expect(svc.acceptRevision(other.ctx, other.project.id, revisionId)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.acceptRevision(other.ctx, project.id, revisionId)).rejects.toMatchObject({ code: "project_not_found" });
    expect((await revisionOf(ctx, project.id)).status).toBe("issued");
  });

  it("returns an empty budget before one exists", async () => {
    const { project, ctx } = await setup();
    expect(await svc.getBudget(ctx, project.id)).toEqual({ revisions: [], revision: null, generation: null });
  });
});

describe("input boundaries (schemas in src/inputs/budget.ts)", () => {
  const MAX_UNIT_PRICE = 100_000_000;
  const line = { description: "Partida", unit: "ud", quantity: 20, unitPriceCents: 100 };

  it("refuses a unit price past its bound as invalid_input, never a database error, and takes the bound", async () => {
    const { project, ctx } = await setup();
    const { revisionId, chapterId } = await framerDraft(ctx, project.id, []);
    const { optionId } = await options.addOption(ctx, project.id, revisionId, { name: "Piscina" });
    const add = (unitPriceCents: unknown, parent = chapterId("01")) => svc.addLine(ctx, project.id, parent, { ...line, unitPriceCents });
    for (const [price, parent] of [
      [MAX_UNIT_PRICE + 1, chapterId("01")],
      [MAX_AMOUNT_CENTS + 1, chapterId("01")],
      [2 ** 31, chapterId("01")],
      [-1, chapterId("01")],
      [-MAX_UNIT_PRICE - 1, optionId],
    ] as const) {
      await expect(add(price, parent)).rejects.toMatchObject({ code: "invalid_input", status: 400 });
    }
    // 20 × 1.000.000,00 € and its deduction: the largest lines there are.
    const { lineId } = await add(MAX_UNIT_PRICE);
    await add(-MAX_UNIT_PRICE, optionId);
    await expect(svc.updateLine(ctx, project.id, lineId, { unitPriceCents: MAX_UNIT_PRICE + 1 })).rejects.toMatchObject({ code: "invalid_input" });
    const revision = await revisionOf(ctx, project.id, revisionId);
    expect(revision.chapters.find((c) => c.code === "01")!.lines.map((l) => l.unitPriceCents)).toEqual([MAX_UNIT_PRICE]);
    expect(revision.options[0]!.lines.map((l) => l.unitPriceCents)).toEqual([-MAX_UNIT_PRICE]);
  });

  it("answers wrong types with each field's old code, and writes nothing", async () => {
    const { tenant, project, ctx } = await setup();
    const fresh = await createTestProject(tenant.id);
    const { revisionId, chapterId } = await framerDraft(ctx, project.id, ["01"]);
    const { optionId } = await options.addOption(ctx, project.id, revisionId, { name: "Piscina" });
    const before = await revisionOf(ctx, project.id, revisionId);
    const lineId = before.chapters[0]!.lines[0]!.id;
    const c01 = chapterId("01");
    const revision = (body: Record<string, unknown>) => () => svc.updateRevision(ctx, project.id, revisionId, body);
    const newLine = (body: Record<string, unknown>) => () => svc.addLine(ctx, project.id, c01, { ...line, ...body });
    const lineChange = (body: Record<string, unknown>) => () => svc.updateLine(ctx, project.id, lineId, body);
    const cases: [() => Promise<unknown>, string][] = [
      [() => svc.createBudget(ctx, fresh.id, { reference: 5 }), "invalid_input"],
      [() => svc.createBudget(ctx, fresh.id, { number: 1000 }), "invalid_input"],
      [() => svc.createBudget(ctx, fresh.id, { number: null }), "invalid_input"],
      [revision({ vatRateBp: 10_001 }), "invalid_input"],
      [revision({ quality: "luxury" }), "invalid_input"],
      [revision({ changeReason: 5 }), "invalid_input"],
      [revision({ builtAreaM2: "200" }), "invalid_input"],
      [revision({ contingencyPct: 51 }), "invalid_input"],
      [revision({ overheadPct: null }), "invalid_input"],
      [revision({ texts: [] }), "invalid_input"],
      [revision({ texts: { cover: { promoter: 5 } } }), "invalid_input"],
      [revision({ texts: { cover: null } }), "invalid_input"],
      [revision({ texts: { justification: { blocks: [{ title: "Estructura" }] } } }), "invalid_input"],
      [revision({ texts: { annex: [{ kind: "todo", title: "T", text: "x" }] } }), "invalid_input"],
      [revision({ texts: { exclusions: Array.from({ length: 51 }, () => "x") } }), "invalid_input"],
      [revision({ texts: { includes: "x".repeat(10_001) } }), "invalid_input"],
      [revision({ exclusions: ["a"] }), "invalid_input"],
      [revision({ conditions: [] }), "invalid_input"],
      [revision({ conditions: { validityDays: 0 } }), "invalid_input"],
      [revision({ review: { done: ["x".repeat(81)] } }), "invalid_input"],
      [revision({ reviewed: null }), "invalid_input"],
      [revision({ reviewed: { key: "", done: true } }), "invalid_input"],
      [() => svc.updateChapter(ctx, project.id, c01, { name: " " }), "missing_fields"],
      [() => svc.updateChapter(ctx, project.id, c01, { pdfNote: 5 }), "invalid_input"],
      [newLine({ description: 5 }), "missing_fields"],
      [newLine({ unit: "x".repeat(11) }), "invalid_input"],
      [newLine({ quantity: "1" }), "invalid_input"],
      [newLine({ quantity: undefined }), "missing_fields"],
      [newLine({ unitPriceCents: undefined }), "missing_fields"],
      [newLine({ unitPriceCents: null }), "missing_fields"],
      [newLine({ unitPriceCents: 1.5 }), "invalid_input"],
      [newLine({ source: "computed" }), "invalid_input"],
      [newLine({ baseCode: "nope" }), "invalid_input"],
      [newLine({ baseCode: 5 }), "invalid_input"],
      [lineChange({ unitPriceCents: null }), "invalid_input"],
      [lineChange({ quantity: -1 }), "invalid_input"],
      [lineChange({ note: 5 }), "invalid_input"],
      [lineChange({ source: null }), "invalid_input"],
      [lineChange({ chapterId: 5 }), "invalid_input"],
      [() => svc.setProgress(ctx, project.id, {}), "missing_fields"],
      [() => svc.setProgress(ctx, project.id, { lines: [null] }), "invalid_input"],
      [() => svc.setProgress(ctx, project.id, { lines: [{ id: lineId, executedPct: 101 }] }), "invalid_input"],
      [() => options.addOption(ctx, project.id, revisionId, { name: " " }), "missing_fields"],
      [() => options.addOption(ctx, project.id, revisionId, { name: "Pérgola", optionKind: "gift" }), "invalid_input"],
      [() => options.addOption(ctx, project.id, revisionId, { baseCode: null }), "invalid_input"],
      [() => options.updateOption(ctx, project.id, optionId, { optionKind: null }), "invalid_input"],
      [() => options.updateOption(ctx, project.id, optionId, { intro: 5 }), "invalid_input"],
      [() => options.updateOption(ctx, project.id, optionId, { replacesLine: "x".repeat(21) }), "invalid_input"],
      [() => options.optionFromLine(ctx, project.id, lineId, {}), "invalid_input"],
      [() => issue.issueRevision(ctx, project.id, revisionId, { issuedOn: "2999-01-01" }), "invalid_date"],
      [() => issue.issueRevision(ctx, project.id, revisionId, { validUntil: 5 }), "invalid_date"],
      [() => issue.issueRevision(ctx, project.id, revisionId, { changeReason: 5 }), "invalid_input"],
    ];
    for (const [call, code] of cases) await expect(call()).rejects.toMatchObject({ code, status: 400 });
    // Checked as sent, before the rest: a FRAMER chapter keeps its code.
    await expect(svc.updateChapter(ctx, project.id, c01, { code: 1 })).rejects.toMatchObject({ code: "fixed_chapters" });
    expect(await revisionOf(ctx, project.id, revisionId)).toEqual(before);
    expect((await svc.getBudget(ctx, fresh.id)).revisions).toEqual([]);
    expect(await documentsService.listDocuments(ctx, project.id)).toEqual([]);
  });

  it("accept and reject: wrong types answer the old codes and leave the revision issued", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    await issue.issueRevision(ctx, project.id, revisionId);
    const accept = (body: Record<string, unknown>) => svc.acceptRevision(ctx, project.id, revisionId, body);
    for (const [body, code] of [
      [{ acceptedOn: "2999-01-01" }, "invalid_date"],
      [{ acceptedOn: null }, "invalid_date"],
      [{ acceptedBy: 5 }, "invalid_input"],
      [{ chosenOptionIds: "all" }, "invalid_input"],
      [{ chosenOptionIds: [5] }, "invalid_input"],
    ] as const) {
      await expect(accept(body)).rejects.toMatchObject({ code, status: 400 });
    }
    await expect(svc.rejectRevision(ctx, project.id, revisionId, { rejectedOn: "nope" })).rejects.toMatchObject({ code: "invalid_date" });
    expect(await revisionOf(ctx, project.id, revisionId)).toMatchObject({ status: "issued", acceptedOn: null, rejectedOn: null });
  });

  it("ignores keys it doesn't take, as before, and reads what it always read", async () => {
    const { tenant, project, ctx } = await setup();
    const { revisionId, chapterId } = await framerDraft(ctx, project.id, []);
    const { lineId } = await svc.addLine(ctx, project.id, chapterId("01"), {
      ...line,
      quantity: 2,
      quantityMilli: 5,
      tenantId: "other",
      chapterId: "elsewhere",
      extra: true,
    });
    const [row] = await db.select().from(budgetLines).where(eq(budgetLines.id, lineId));
    expect(row).toMatchObject({ tenantId: tenant.id, chapterId: chapterId("01"), quantityMilli: 2000, source: "manual" });

    await svc.updateRevision(ctx, project.id, revisionId, { status: "accepted", number: 7, tenantId: "other" });
    expect(await revisionOf(ctx, project.id, revisionId)).toMatchObject({ status: "draft", number: 0 });

    // An annex item keeps its id (up to 40 characters) or gets one; a cover sent as an array changes nothing, as before.
    await svc.updateRevision(ctx, project.id, revisionId, {
      texts: {
        cover: { promoter: "Ana Ruiz", unknown: "x" },
        annex: [
          { id: "a".repeat(50), kind: "note", title: "Nota", text: "x" },
          { kind: "assumption", title: "Parcela", text: "y" },
        ],
        exclusions: ["  Licencias ", " "],
      },
    });
    await svc.updateRevision(ctx, project.id, revisionId, { texts: { cover: [] } });
    const { texts } = await revisionOf(ctx, project.id, revisionId);
    expect(texts.cover).toMatchObject({ promoter: "Ana Ruiz" });
    expect(texts.cover).not.toHaveProperty("unknown");
    expect(texts.annex.map((a) => a.id)).toEqual(["a".repeat(40), expect.stringMatching(/^[0-9a-f-]{36}$/)]);
    expect(texts.exclusions).toEqual(["Licencias"]);

    // An option's text is `intro`; its column's own name, `pdfNote`, is read when `intro` isn't sent.
    const { optionId } = await options.addOption(ctx, project.id, revisionId, { name: "Piscina", pdfNote: "Not read on create" });
    const pdfNote = async () => (await revisionOf(ctx, project.id, revisionId)).options.find((o) => o.id === optionId)!.pdfNote;
    expect(await pdfNote()).toBeNull();
    await options.updateOption(ctx, project.id, optionId, { pdfNote: "Por la parcela" });
    expect(await pdfNote()).toBe("Por la parcela");
    await options.updateOption(ctx, project.id, optionId, { intro: "Gana", pdfNote: "Pierde" });
    expect(await pdfNote()).toBe("Gana");
  });
});
