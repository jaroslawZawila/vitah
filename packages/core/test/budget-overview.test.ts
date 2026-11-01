import { beforeEach, describe, expect, it, vi } from "vitest";
import { budgetChapters, budgetGenerations, budgetRevisions, db, eq } from "@repo/db";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { budgetOptionsService as options, budgetOverviewService as svc, budgetService, type Ctx } from "../src";
import { addDays, todayInSpain } from "../src/obra-calc";
import { files } from "../src/testing";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

async function setup(role: Ctx["role"] = "manager") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role });
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role };
  return { tenant, ctx };
}

/** Moves a revision on without the PDFs issuing renders: the list only reads its row. */
const setRevision = (id: string, values: Partial<typeof budgetRevisions.$inferInsert>) =>
  db.update(budgetRevisions).set(values).where(eq(budgetRevisions.id, id));

const generation = (tenantId: string, projectId: string, status: "running" | "failed", step = 2) =>
  db.insert(budgetGenerations).values({ tenantId, projectId, status, step, options: {}, documentIds: [] });

describe("listBudgets", () => {
  it("shows every obra's newest revision at its price, what it waits for, and the totals", async () => {
    const { tenant, ctx } = await setup();
    const today = todayInSpain();
    const client = await createTestUser(tenant.id, { role: "client", name: "Lucía Ferrer" });

    // A draft with one estimated line: a check to tick before issuing. 13 % + 6 % on top of the cost.
    const draftProject = await createTestProject(tenant.id, { ref: "VTH-1" });
    const draft = await framerDraft(ctx, draftProject.id, ["01"], 100_000, { overheadPct: 13, profitPct: 6 });
    await budgetService.addLine(ctx, draftProject.id, draft.chapterId("02"), {
      code: "02.01", description: "Cimentación estimada", unit: "pa", quantity: 1, unitPriceCents: 50_000, source: "estimated",
    });

    // Issued, valid three more days.
    const issuedProject = await createTestProject(tenant.id, { ref: "VTH-2" });
    const issued = await framerDraft(ctx, issuedProject.id, ["01"], 200_000);
    await setRevision(issued.revisionId, { status: "issued", issuedOn: addDays(today, -27), validUntil: addDays(today, 3) });

    // Accepted with a chosen option: the contract is the PEC plus it. 100 m² built.
    const acceptedProject = await createTestProject(tenant.id, { ref: "VTH-3", clientUserId: client.id });
    const accepted = await framerDraft(ctx, acceptedProject.id, ["01"], 100_000);
    const { optionId } = await options.addOption(ctx, acceptedProject.id, accepted.revisionId, { name: "Piscina" });
    await budgetService.addLine(ctx, acceptedProject.id, optionId, {
      code: "OP.01", description: "Piscina", unit: "ud", quantity: 1, unitPriceCents: 10_000,
    });
    await db.update(budgetChapters).set({ chosen: true }).where(eq(budgetChapters.id, optionId));
    await setRevision(accepted.revisionId, { status: "accepted", acceptedOn: today, acceptedAt: new Date(), builtAreaCm2: 100_00 });

    // A newer revision replaces what shows: Rev.1 rejected over Rev.0.
    const rejectedProject = await createTestProject(tenant.id, { ref: "VTH-4" });
    const first = await framerDraft(ctx, rejectedProject.id, ["01"], 100_000);
    await setRevision(first.revisionId, { status: "issued", issuedOn: addDays(today, -20) });
    const { revisionId: second } = await budgetService.createRevision(ctx, rejectedProject.id);
    await setRevision(second, { status: "rejected", rejectedOn: today, builtAreaCm2: 50_00 });

    // No budget: the AI drafting one, one whose run failed, one never started.
    const running = await createTestProject(tenant.id, { ref: "VTH-5" });
    await generation(tenant.id, running.id, "running", 3);
    const failed = await createTestProject(tenant.id, { ref: "VTH-6" });
    await generation(tenant.id, failed.id, "failed");
    await createTestProject(tenant.id, { ref: "VTH-7", address: "Paseo del Río 2" });

    const { items, summary } = await svc.listBudgets(ctx);
    const byRef = new Map(items.map((i) => [i.ref, i]));

    const d = byRef.get("VTH-1")!.revision!;
    expect(d).toMatchObject({ number: 0, status: "draft", openChecks: 1, daysLeft: null, chosenOptions: 0 });
    // The cost is the lines plus 5 % contingency; the price carries both margins, as on the Budget tab.
    expect(d.costCents).toBe(157_500);
    expect(d.totalCents).toBe((await budgetService.getBudget(ctx, draftProject.id)).revision!.totalCents);
    expect(d.totalCents).toBeGreaterThan(d.costCents);
    expect(d.contractTotalCents).toBe(d.totalCents);

    expect(byRef.get("VTH-2")!.revision).toMatchObject({ status: "issued", totalCents: 210_000, daysLeft: 3, openChecks: null });

    const a = byRef.get("VTH-3")!;
    expect(a.clientName).toBe("Lucía Ferrer");
    expect(a.revision).toMatchObject({
      status: "accepted",
      totalCents: 105_000,
      contractTotalCents: 115_000,
      chosenOptions: 1,
      perM2Cents: 1_050,
      perM2DeltaBp: 0,
    });

    // Rev.1 copies Rev.0: 105.000 over 50 m² is twice the accepted average.
    expect(byRef.get("VTH-4")!.revision).toMatchObject({ number: 1, status: "rejected", rejectedOn: today, perM2DeltaBp: 10_000 });

    expect(byRef.get("VTH-5")).toMatchObject({ revision: null, generation: { status: "running", step: 3 } });
    expect(byRef.get("VTH-6")).toMatchObject({ revision: null, generation: { status: "failed" } });
    expect(byRef.get("VTH-7")).toMatchObject({ revision: null, generation: null, address: "Paseo del Río 2", clientName: null });

    expect(summary).toEqual({
      drafts: 1,
      generating: 1,
      openChecks: 1,
      issued: 1,
      issuedCents: 210_000,
      expiring: 1,
      accepted: 1,
      contractCents: 115_000,
      averagePerM2Cents: 1_050,
      aboveAverage: 1,
    });
  });

  it("lists the budget changed last first, any draft write counting as a change", async () => {
    const { tenant, ctx } = await setup();
    const older = await createTestProject(tenant.id, { ref: "VTH-OLD" });
    const newer = await createTestProject(tenant.id, { ref: "VTH-NEW" });
    const { chapterId } = await framerDraft(ctx, older.id, []);
    await framerDraft(ctx, newer.id, ["01"]);
    expect((await svc.listBudgets(ctx)).items.map((i) => i.ref)).toEqual(["VTH-NEW", "VTH-OLD"]);

    await budgetService.addLine(ctx, older.id, chapterId("03"), {
      code: "03.01", description: "Estructura", unit: "pa", quantity: 1, unitPriceCents: 1_000,
    });
    expect((await svc.listBudgets(ctx)).items.map((i) => i.ref)).toEqual(["VTH-OLD", "VTH-NEW"]);

    // Deleting a line counts too.
    const newest = (await budgetService.getBudget(ctx, newer.id)).revision!;
    await budgetService.deleteLine(ctx, newer.id, newest.chapters[0]!.lines[0]!.id);
    expect((await svc.listBudgets(ctx)).items.map((i) => i.ref)).toEqual(["VTH-NEW", "VTH-OLD"]);
  });

  it("flags an issued budget past its validity, and reads for viewers too", async () => {
    const { tenant, ctx } = await setup("viewer");
    const editor: Ctx = { ...ctx, role: "manager" };
    const project = await createTestProject(tenant.id);
    const { revisionId } = await framerDraft(editor, project.id, ["01"]);
    await setRevision(revisionId, { status: "issued", issuedOn: addDays(todayInSpain(), -40), validUntil: addDays(todayInSpain(), -10) });

    const { items, summary } = await svc.listBudgets(ctx);
    expect(items[0]!.revision!.daysLeft).toBe(-10);
    expect(summary.expiring).toBe(1);
    expect(summary.averagePerM2Cents).toBeNull();
    expect(items[0]!.revision!.perM2DeltaBp).toBeNull();
  });

  it("keeps to the caller's tenant", async () => {
    const mine = await setup();
    const theirs = await setup();
    const own = await createTestProject(mine.tenant.id, { ref: "MINE" });
    const other = await createTestProject(theirs.tenant.id, { ref: "THEIRS" });
    await framerDraft(mine.ctx, own.id, ["01"]);
    await framerDraft(theirs.ctx, other.id, ["01"], 900_000);
    await generation(theirs.tenant.id, other.id, "running");

    const { items, summary } = await svc.listBudgets(mine.ctx);
    expect(items.map((i) => i.ref)).toEqual(["MINE"]);
    expect(summary).toMatchObject({ drafts: 1, generating: 0 });
  });
});
