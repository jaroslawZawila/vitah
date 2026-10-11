import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { budgetChapters, budgetLines, budgetRevisions, db, eq } from "@repo/db";
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
  BUDGET_CHAPTER_CODES,
  type Ctx,
} from "../src";
import { CHAPTER_NAMES } from "../src/budget-template";
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
      unitPriceCents: 173_250,
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
      { name: "Puerta de garaje seccional motorizada", totalCents: 320_250, lines: [{ code: "OP.01", baseCode: "10.09", source: "base" }] },
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
    await issue.issueRevision(ctx, project.id, revisionId);

    await svc.acceptRevision(ctx, project.id, revisionId, { acceptedOn: "2026-10-21", acceptedBy: "D. Roberto Guzmán", chosenOptionIds: [pool] });

    const revision = await revisionOf(ctx, project.id);
    expect(revision).toMatchObject({ status: "accepted", acceptedOn: "2026-10-21", acceptedBy: "D. Roberto Guzmán", totalCents: 278_513, contractTotalCents: 1_278_513 });
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

    expect((await revisionOf(ctx, project.id)).status).toBe("accepted");
    const docs = await documentsService.listDocuments(ctx, project.id);
    expect(docs.find((d) => d.category === "contract")).toMatchObject({ title: "Presupuesto 036/2026 · Rev.0 · firmado" });
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
    await svc.acceptRevision(ctx, project.id, rev1);
    const budget = await svc.getBudget(ctx, project.id);
    expect(budget.revisions.map((r) => [r.number, r.status])).toEqual([[1, "accepted"], [0, "superseded"]]);
  });

  it("accepts a draft directly, for /api/v1 callers that predate issuing", async () => {
    const { project, ctx } = await setup();
    const { revisionId, c1 } = await draftBudget(ctx, project.id);
    await svc.acceptRevision(ctx, project.id, revisionId);

    await expect(svc.addLine(ctx, project.id, c1, line("01.03", 1, 1))).rejects.toMatchObject({ code: "not_draft", status: 409 });
    const [l1, l2] = (await revisionOf(ctx, project.id)).chapters[0]!.lines;
    await svc.setProgress(ctx, project.id, { lines: [{ id: l1!.id, executedPct: 100 }, { id: l2!.id, executedPct: 50 }] });

    const revision = await revisionOf(ctx, project.id);
    expect(revision).toMatchObject({ status: "accepted", acceptedAt: expect.any(String) });
    expect(revision.chapters[0]).toMatchObject({ executedCents: 92_750 + 36_250, progressPct: 78, status: "active" });
  });

  it("records progress only on the accepted revision, within 0–100", async () => {
    const { project, ctx } = await setup();
    await draftBudget(ctx, project.id);
    const lineId = (await revisionOf(ctx, project.id)).chapters[0]!.lines[0]!.id;

    await expect(svc.setProgress(ctx, project.id, { lines: [{ id: lineId, executedPct: 10 }] })).rejects.toMatchObject({ code: "not_accepted" });
    await svc.acceptRevision(ctx, project.id, (await revisionOf(ctx, project.id)).id);
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
    await svc.acceptRevision(ctx, project.id, revisionId);
    const { revisionId: rev1 } = await svc.createRevision(ctx, project.id);
    // Progress recorded after the draft was copied still carries over.
    const accepted = await revisionOf(ctx, project.id, revisionId);
    await svc.setProgress(ctx, project.id, { lines: [{ id: accepted.chapters[0]!.lines[0]!.id, executedPct: 80 }] });

    await svc.acceptRevision(ctx, project.id, rev1);

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
    await svc.acceptRevision(ctx, project.id, revisionId);
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
    expect(revision.texts.cover).toMatchObject({ promoter: "D. Roberto Guzmán Mesa", site: "" });
    expect(revision.texts.justification.blocks).toEqual([{ title: "Estructura", text: "Steel Frame" }]);
    // The intro keeps its default: sections merge, fields within them are replaced.
    expect(revision.texts.justification.intro).toContain("FRAMER Steel Frame");
    await expect(svc.updateRevision(ctx, project.id, revisionId, { texts: { annex: [{ kind: "rumour", title: "", text: "" }] } })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.updateRevision(ctx, project.id, revisionId, { quality: "luxury" })).rejects.toMatchObject({ code: "invalid_input" });
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
    // Another project's issued budget: 01 at 100 €/m² built.
    const reference = await createTestProject(tenant.id);
    const { revisionId: refRev, chapterId: refChapter } = await framerDraft(ctx, reference.id, []);
    await svc.addLine(ctx, reference.id, refChapter("01"), line("01.01", 100, 10_000));
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
    // A new revision keeps what was ticked: the line is the same line.
    await issue.issueRevision(ctx, project.id, revisionId, { shareWithClient: false });
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
  });

  it("returns an empty budget before one exists", async () => {
    const { project, ctx } = await setup();
    expect(await svc.getBudget(ctx, project.id)).toEqual({ revisions: [], revision: null, generation: null });
  });
});
