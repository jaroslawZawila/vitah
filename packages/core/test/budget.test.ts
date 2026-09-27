import { beforeEach, describe, expect, it } from "vitest";
import { budgetLines, budgetRevisions, db, eq } from "@repo/db";
import {
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { budgetService as svc, hitosService, type Ctx } from "../src";

async function setup(role: Ctx["role"] = "manager") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  const project = await createTestProject(tenant.id);
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role };
  return { tenant, project, ctx };
}

const line = (code: string, quantity: number, unitPriceCents: number) => ({
  code,
  description: `Partida ${code}`,
  unit: "m²",
  quantity,
  unitPriceCents,
});

/** A draft Rev.0 with chapter 01 (two lines) and chapter 02 (one line). */
async function draftBudget(ctx: Ctx, projectId: string) {
  const { revisionId } = await svc.createBudget(ctx, projectId, { reference: "036/2026" });
  const { chapterId: c1 } = await svc.addChapter(ctx, projectId, revisionId, {
    code: "01",
    name: "Actuaciones previas",
  });
  const { chapterId: c2 } = await svc.addChapter(ctx, projectId, revisionId, {
    code: "02",
    name: "Saneamiento",
  });
  await svc.addLine(ctx, projectId, c1, line("01.01", 265, 350)); // 927,50
  await svc.addLine(ctx, projectId, c1, line("01.02", 10, 7_250)); // 725,00
  await svc.addLine(ctx, projectId, c2, line("02.01", 1, 1_000_00)); // 1.000,00
  return { revisionId, c1, c2 };
}

beforeEach(resetDatabase);

describe("createBudget", () => {
  it("starts Rev.0 as a draft and the standard hitos H0–H9", async () => {
    const { project, ctx } = await setup();

    const { revisionId } = await svc.createBudget(ctx, project.id, { reference: "036/2026" });

    const budget = await svc.getBudget(ctx, project.id);
    expect(budget.revisions).toEqual([
      { id: revisionId, number: 0, status: "draft", totalCents: 0, acceptedAt: null },
    ]);
    expect(budget.revision).toMatchObject({ reference: "036/2026", vatRateBp: 1000, chapters: [] });
    const hitos = await hitosService.listHitos(ctx, project.id);
    expect(hitos.map((h) => h.code)).toEqual(["H0", "H1", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9"]);
    expect(hitos.reduce((sum, h) => sum + h.pctBp, 0)).toBe(10_000);
  });

  it("can start at a later revision number", async () => {
    const { project, ctx } = await setup();
    await svc.createBudget(ctx, project.id, { number: 3 });
    expect((await svc.getBudget(ctx, project.id)).revisions[0]?.number).toBe(3);
  });

  it("refuses a second budget", async () => {
    const { project, ctx } = await setup();
    await svc.createBudget(ctx, project.id, {});
    await expect(svc.createBudget(ctx, project.id, {})).rejects.toMatchObject({
      code: "budget_exists",
      status: 409,
    });
  });
});

describe("chapters and lines", () => {
  it("adds up amounts, totals, shares and VAT", async () => {
    const { project, ctx } = await setup();
    await draftBudget(ctx, project.id);

    const { revision } = await svc.getBudget(ctx, project.id);

    expect(revision).toMatchObject({ totalCents: 265_250, vatCents: 26_525 });
    const [c1, c2] = revision!.chapters;
    expect(c1).toMatchObject({ code: "01", totalCents: 165_250, shareBp: 6230, change: null, previousTotalCents: null });
    expect(c1?.lines.map((l) => [l.code, l.quantity, l.amountCents])).toEqual([
      ["01.01", 265, 92_750],
      ["01.02", 10, 72_500],
    ]);
    expect(c2).toMatchObject({ code: "02", totalCents: 100_000, shareBp: 3770 });
  });

  it("edits and deletes chapters and lines of a draft", async () => {
    const { project, ctx } = await setup();
    const { c1, c2 } = await draftBudget(ctx, project.id);
    const lineId = (await svc.getBudget(ctx, project.id)).revision!.chapters[0]!.lines[0]!.id;

    await svc.updateChapter(ctx, project.id, c1, { name: "Movimiento de tierras", changeNote: "BC3" });
    await svc.updateLine(ctx, project.id, lineId, { quantity: 100.5, unitPriceCents: 200 });
    await svc.deleteChapter(ctx, project.id, c2);

    const { revision } = await svc.getBudget(ctx, project.id);
    expect(revision!.chapters).toHaveLength(1);
    expect(revision!.chapters[0]).toMatchObject({ name: "Movimiento de tierras", changeNote: "BC3" });
    expect(revision!.chapters[0]!.lines[0]).toMatchObject({ quantity: 100.5, amountCents: 20_100 });

    await svc.deleteLine(ctx, project.id, lineId);
    expect((await svc.getBudget(ctx, project.id)).revision!.chapters[0]!.lines).toHaveLength(1);
  });

  it("takes quantities as entered, never in stored thousandths", async () => {
    const { project, ctx } = await setup();
    const { c1 } = await draftBudget(ctx, project.id);

    const { lineId } = await svc.addLine(ctx, project.id, c1, { ...line("01.09", 2, 100), quantityMilli: 999_999 });
    await expect(svc.addLine(ctx, project.id, c1, { code: "01.10", description: "X", unit: "pa", unitPriceCents: 1, quantityMilli: 1000 })).rejects.toMatchObject({ code: "missing_fields" });
    await svc.updateLine(ctx, project.id, lineId, { quantityMilli: 5 });

    const lines = (await svc.getBudget(ctx, project.id)).revision!.chapters[0]!.lines;
    expect(lines.find((l) => l.id === lineId)).toMatchObject({ quantity: 2, amountCents: 200 });
  });

  it("validates input", async () => {
    const { project, ctx } = await setup();
    const { revisionId, c1 } = await draftBudget(ctx, project.id);

    await expect(svc.addChapter(ctx, project.id, revisionId, { code: "01", name: "Otra" })).rejects.toMatchObject({ code: "duplicate_code" });
    await expect(svc.addChapter(ctx, project.id, revisionId, { code: " ", name: "X" })).rejects.toMatchObject({ code: "missing_fields" });
    await expect(svc.addLine(ctx, project.id, c1, { ...line("01.09", -1, 100) })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.addLine(ctx, project.id, c1, { ...line("01.09", 1, 1.5) })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.addLine(ctx, project.id, c1, { code: "01.09" })).rejects.toMatchObject({ code: "missing_fields" });
  });
});

describe("revisions", () => {
  it("accepts a draft, which locks it and lets staff record progress", async () => {
    const { project, ctx } = await setup();
    const { revisionId, c1 } = await draftBudget(ctx, project.id);
    await svc.acceptRevision(ctx, project.id, revisionId);

    await expect(svc.addChapter(ctx, project.id, revisionId, { code: "03", name: "X" })).rejects.toMatchObject({ code: "not_draft", status: 409 });
    await expect(svc.addLine(ctx, project.id, c1, line("01.03", 1, 1))).rejects.toMatchObject({ code: "not_draft" });

    const [l1, l2] = (await svc.getBudget(ctx, project.id)).revision!.chapters[0]!.lines;
    await svc.setProgress(ctx, project.id, { lines: [{ id: l1!.id, executedPct: 100 }, { id: l2!.id, executedPct: 50 }] });

    const { revision } = await svc.getBudget(ctx, project.id);
    expect(revision).toMatchObject({ status: "accepted", acceptedAt: expect.any(String) });
    expect(revision!.chapters[0]).toMatchObject({ executedCents: 92_750 + 36_250, progressPct: 78, status: "active" });
  });

  it("records progress only on the accepted revision, within 0–100", async () => {
    const { project, ctx } = await setup();
    await draftBudget(ctx, project.id);
    const lineId = (await svc.getBudget(ctx, project.id)).revision!.chapters[0]!.lines[0]!.id;

    await expect(svc.setProgress(ctx, project.id, { lines: [{ id: lineId, executedPct: 10 }] })).rejects.toMatchObject({ code: "not_accepted" });
    await svc.acceptRevision(ctx, project.id, (await svc.getBudget(ctx, project.id)).revision!.id);
    await expect(svc.setProgress(ctx, project.id, { lines: [{ id: lineId, executedPct: 101 }] })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("copies the newest revision into a new draft and compares them", async () => {
    const { project, ctx } = await setup();
    const { revisionId, c2 } = await draftBudget(ctx, project.id);
    await svc.acceptRevision(ctx, project.id, revisionId);

    const { revisionId: rev1 } = await svc.createRevision(ctx, project.id);
    const draft = (await svc.getBudget(ctx, project.id, rev1)).revision!;
    expect(draft).toMatchObject({ number: 1, status: "draft", previous: { number: 0, totalCents: 265_250 } });
    expect(draft.chapters.map((c) => [c.code, c.change])).toEqual([["01", null], ["02", null]]);

    const [d1, d2] = draft.chapters;
    await svc.addLine(ctx, project.id, d1!.id, line("01.03", 1, 1_000));
    await svc.updateLine(ctx, project.id, d2!.lines[0]!.id, { unitPriceCents: 50_000 });
    await svc.addChapter(ctx, project.id, rev1, { code: "16", name: "Seguridad y salud" });

    const compared = (await svc.getBudget(ctx, project.id, rev1)).revision!;
    expect(compared.chapters.map((c) => [c.code, c.change, c.previousTotalCents])).toEqual([
      ["01", "up", 165_250],
      ["02", "down", 100_000],
      ["16", "new", null],
    ]);
    // The original revision is untouched.
    expect((await svc.getBudget(ctx, project.id, revisionId)).revision!.chapters[1]!.totalCents).toBe(100_000);
    // Only one draft at a time.
    await expect(svc.createRevision(ctx, project.id)).rejects.toMatchObject({ code: "draft_exists" });
    expect(c2).toBeTruthy();
  });

  it("lists dropped chapters", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    await svc.acceptRevision(ctx, project.id, revisionId);
    const { revisionId: rev1 } = await svc.createRevision(ctx, project.id);
    const draft = (await svc.getBudget(ctx, project.id, rev1)).revision!;
    await svc.deleteChapter(ctx, project.id, draft.chapters[1]!.id);

    expect((await svc.getBudget(ctx, project.id, rev1)).revision!.removedChapters).toEqual([
      { code: "02", name: "Saneamiento", totalCents: 100_000 },
    ]);
  });

  it("supersedes the accepted revision and keeps the progress recorded on it", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);
    await svc.acceptRevision(ctx, project.id, revisionId);
    const { revisionId: rev1 } = await svc.createRevision(ctx, project.id);
    // Progress recorded after the draft was copied still carries over.
    const accepted = (await svc.getBudget(ctx, project.id, revisionId)).revision!;
    await svc.setProgress(ctx, project.id, { lines: [{ id: accepted.chapters[0]!.lines[0]!.id, executedPct: 80 }] });

    await svc.acceptRevision(ctx, project.id, rev1);

    const budget = await svc.getBudget(ctx, project.id);
    expect(budget.revisions.map((r) => [r.number, r.status])).toEqual([[1, "accepted"], [0, "superseded"]]);
    expect(budget.revision!.chapters[0]!.lines[0]!.executedPct).toBe(80);
  });

  it("refuses a draft edit that races the draft being accepted", async () => {
    const { project, ctx } = await setup();
    const { revisionId, c2 } = await draftBudget(ctx, project.id);
    const [target] = await db.select().from(budgetLines).where(eq(budgetLines.chapterId, c2));
    // Another request accepts the draft: it holds the revision's row, not yet committed.
    let commit!: () => void;
    let accepted!: () => void;
    const isAccepted = new Promise<void>((resolve) => (accepted = resolve));
    const accepting = db.transaction(async (tx) => {
      await tx
        .update(budgetRevisions)
        .set({ status: "accepted" })
        .where(eq(budgetRevisions.id, revisionId));
      accepted();
      await new Promise<void>((resolve) => (commit = resolve));
    });
    await isAccepted;

    // The edit's checks still see a draft; its write waits for the lock, then sees the contract.
    const edit = svc.updateLine(ctx, project.id, target!.id, { description: "Changed" }).catch((e) => e);
    await new Promise((resolve) => setTimeout(resolve, 200));
    commit();
    await accepting;

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
  });

  it("updates a draft's details", async () => {
    const { project, ctx } = await setup();
    const { revisionId } = await draftBudget(ctx, project.id);

    await svc.updateRevision(ctx, project.id, revisionId, {
      reference: "037/2026",
      vatRateBp: 2100,
      builtAreaM2: 253.45,
      usefulAreaM2: 208.25,
      exclusions: "Geotécnico\n\nMobiliario ",
    });

    expect((await svc.getBudget(ctx, project.id)).revision).toMatchObject({
      reference: "037/2026",
      vatRateBp: 2100,
      vatCents: 55_703,
      builtAreaM2: 253.45,
      usefulAreaM2: 208.25,
      exclusions: ["Geotécnico", "Mobiliario"],
    });
  });
});

describe("access", () => {
  it("lets viewers read but not change", async () => {
    const { tenant, project, ctx } = await setup();
    await draftBudget(ctx, project.id);
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    const vctx: Ctx = { tenantId: tenant.id, userId: viewer.id, role: "viewer" };

    expect((await svc.getBudget(vctx, project.id)).revision?.chapters).toHaveLength(2);
    await expect(svc.createRevision(vctx, project.id)).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("keeps tenants apart", async () => {
    const { project, ctx } = await setup();
    const { c1 } = await draftBudget(ctx, project.id);
    const other = await setup();
    const [row] = await db.select().from(budgetLines).where(eq(budgetLines.chapterId, c1));

    await expect(svc.getBudget(other.ctx, project.id)).rejects.toMatchObject({ code: "project_not_found" });
    await expect(svc.updateChapter(other.ctx, project.id, c1, { name: "X" })).rejects.toMatchObject({ code: "project_not_found" });
    // Its own project, someone else's line.
    await expect(svc.updateLine(other.ctx, other.project.id, row!.id, { quantity: 1 })).rejects.toMatchObject({ code: "not_found" });
  });

  it("returns an empty budget before one exists", async () => {
    const { project, ctx } = await setup();
    expect(await svc.getBudget(ctx, project.id)).toEqual({ revisions: [], revision: null });
  });
});
