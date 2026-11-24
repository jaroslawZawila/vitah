import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { db } from "@repo/db";
import {
  budgetOptionsService,
  budgetOverviewService as svc,
  budgetService,
  constructionService,
  hitosService,
  obraService,
  projectsService,
  purchaseInvoicesService,
  purchaseRequestsService,
  subcontractorsService,
  type Ctx,
} from "../src";
import { projectSchedule } from "../src/contract";
import { loadObra, loadObraSummaries } from "../src/obra-data";
import { projectSignals } from "../src/project-signals";
import { files } from "../src/testing";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

afterEach(() => vi.useRealTimers());

async function setup() {
  const tenant = await createTestTenant();
  const admin: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" };
  return { tenant, admin };
}

/** A project with dates and an accepted budget of chapters 01–03 (no margins): H2 closes 01 and 02, H3 03. */
async function contracted(admin: Ctx, ref: string) {
  const project = await createTestProject(admin.tenantId, {
    ref,
    startDate: new Date("2026-06-01T00:00:00Z"),
    completionDate: new Date("2027-03-31T00:00:00Z"),
  });
  const { revisionId } = await framerDraft(admin, project.id, ["01", "02", "03"]);
  await budgetService.acceptRevision(admin, project.id, revisionId, {}, { unissued: true });
  return project;
}

/** The demo obra (`pnpm db:seed`): the Caviedes budget part built, its plan, subcontractors, orders, invoices, requests. */
async function seeded(admin: Ctx, ref: string) {
  const { seedObra, seedControl } = await import("../src/seed/seed-obra");
  const { seedPlanning } = await import("../src/seed/planning");
  const { seedSubcontractors } = await import("../src/seed/subcontractors");
  const { seedPurchasing } = await import("../src/seed/purchasing");
  const { seedPurchaseInvoices } = await import("../src/seed/purchase-invoices");
  const { seedPurchaseRequests } = await import("../src/seed/purchase-requests");
  const project = await createTestProject(admin.tenantId, {
    ref,
    startDate: new Date("2026-03-02T00:00:00Z"),
    completionDate: new Date("2026-12-18T00:00:00Z"),
  });
  await seedObra(admin, project.id, { files: false });
  await seedControl(admin, project.id);
  await seedPlanning(admin, project.id);
  await seedSubcontractors(admin, project.id, { files: false });
  await seedPurchasing(admin, project.id);
  await seedPurchaseInvoices(admin, project.id);
  await seedPurchaseRequests(admin, project.id);
  return project;
}

/** The project list as the portal asks for it: with the signals. */
const listWithSignals = (ctx: Ctx) => svc.listProjectsWithBudget(ctx, { signals: true });
type Row = Awaited<ReturnType<typeof listWithSignals>>[number];
const listed = async (ctx: Ctx, id: string) => (await listWithSignals(ctx)).find((p) => p.id === id);
const countOf = (row: Row, kind: string) => row.attention.find((a) => a.kind === kind)?.count ?? 0;

/** Every query the database client is sent while `run` runs. */
async function queriesOf(run: () => Promise<unknown>) {
  const client = (db as unknown as { session: { client: { unsafe: (...args: unknown[]) => unknown } } }).session.client;
  const spy = vi.spyOn(client, "unsafe");
  try {
    await run();
    return spy.mock.calls.length;
  } finally {
    spy.mockRestore();
  }
}

describe("project signals", () => {
  it("say what the Obra tab, Hitos, Compras and Subcontratas say of the same obra", async () => {
    const { admin } = await setup();
    const demo = await seeded(admin, "VTH-1");
    const plain = await contracted(admin, "VTH-2");
    const viewer: Ctx = { ...admin, role: "viewer" };

    for (const project of [demo, plain]) {
      const [row, control, obra, requests, invoices] = await Promise.all([
        listed(viewer, project.id),
        constructionService.getControl(admin, project.id),
        obraService.getObra(admin, project.id),
        purchaseRequestsService.listRequests(admin, { projectId: project.id }),
        purchaseInvoicesService.listInvoices(admin, { projectId: project.id }),
      ]);
      // The same rule and inputs as Obra › Resumen: they can't disagree.
      expect(row!.schedule).toEqual(projectSchedule(control.schedule));
      expect(row!.progressPct).toBe(obra.progressPct);
      expect(countOf(row!, "documents")).toBe(control.documentAlerts.length);
      expect(countOf(row!, "late_deliveries")).toBe(control.lateDeliveries.length);
      expect(countOf(row!, "to_invoice")).toBe(control.milestones.filter((m) => m.state === "reached" || m.state === "requested").length);
      expect(countOf(row!, "requests")).toBe(requests.requests.filter((r) => r.status === "pending").length);
      expect(countOf(row!, "supplier_overdue")).toBe(invoices.summary.overdueInvoices);
      expect(row!.attention.find((a) => a.kind === "supplier_overdue")?.amountCents ?? 0).toBe(invoices.summary.overdueCents);
    }

    // The demo obra has something of each but a collection; the new one, simulated dates and nothing to do.
    const row = (await listed(viewer, demo.id))!;
    expect(row.schedule!.status).toBe("late");
    expect(row.schedule!.days).toBeGreaterThan(0);
    expect(row.progressPct).toBeGreaterThan(0);
    expect(row.attention.map((a) => a.kind)).toEqual(["to_invoice", "supplier_overdue", "requests", "late_deliveries", "documents"]);
    expect(await listed(viewer, plain.id)).toMatchObject({ schedule: { status: "simulated", days: null }, progressPct: 0, attention: [] });
  });

  it("give an obra without a contract no schedule nor built %", async () => {
    const { admin } = await setup();
    const bare = await createTestProject(admin.tenantId, { ref: "VTH-1" });
    await framerDraft(admin, bare.id, ["01"], 100_000);

    expect(await listed(admin, bare.id)).toMatchObject({ schedule: null, progressPct: null, attention: [] });
  });

  it("follow the hitos: to invoice once reached, overdue once invoiced and past its due day unpaid", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T10:00:00Z") });
    const { admin } = await setup();
    const project = await contracted(admin, "VTH-1");
    for (const code of ["01", "02", "03"]) {
      await constructionService.startChapter(admin, project.id, code, { date: "2026-07-01" });
      await constructionService.finishChapter(admin, project.id, code, { date: "2026-08-01" });
    }
    let row = (await listed(admin, project.id))!;
    // H2 and H3 asked for their invoices.
    expect(row.attention).toEqual([{ kind: "to_invoice", count: 2 }]);

    const [h2, h3] = (await hitosService.listHitos(admin, project.id)).filter((h) => h.code === "H2" || h.code === "H3");
    const invoice = (hitoId: string, date: string) =>
      hitosService.uploadHitoFile(admin, project.id, hitoId, "invoice", {
        file: new File(["%PDF-1.7 factura"], "f.pdf", { type: "application/pdf" }),
        date,
      });
    await invoice(h2!.id, "2026-08-03");
    // Due within its term: nothing to chase yet.
    await invoice(h3!.id, "2026-10-15");
    row = (await listed(admin, project.id))!;
    expect(row.attention).toEqual([{ kind: "collection_overdue", count: 1 }]);

    await hitosService.registerPayment(admin, project.id, h2!.id, { paidOn: "2026-10-16" });
    expect((await listed(admin, project.id))!.attention).toEqual([]);
  });

  it("leave out deleted projects and deleted rows", async () => {
    const { admin } = await setup();
    const demo = await seeded(admin, "VTH-1");
    const before = (await listed(admin, demo.id))!;

    // A deleted supplier invoice owes nothing; a company taken off the obra warns of nothing there.
    const { invoices } = await purchaseInvoicesService.listInvoices(admin, { projectId: demo.id }, { group: "overdue" });
    await purchaseInvoicesService.deleteInvoice(admin, invoices[0]!.id);
    const control = await constructionService.getControl(admin, demo.id);
    const company = control.documentAlerts[0]!.subcontractorId;
    await subcontractorsService.removeAssignment(admin, company, demo.id);
    const after = (await listed(admin, demo.id))!;
    expect(countOf(after, "supplier_overdue")).toBe(countOf(before, "supplier_overdue") - 1);
    expect(countOf(after, "documents")).toBe((await constructionService.getControl(admin, demo.id)).documentAlerts.length);
    expect(countOf(after, "documents")).toBeLessThan(countOf(before, "documents"));

    // A deleted project leaves the list, and nothing of it is counted for another.
    const other = await contracted(admin, "VTH-2");
    await projectsService.deleteProject(admin, demo.id);
    const rows = await listWithSignals(admin);
    expect(rows.map((r) => r.id)).toEqual([other.id]);
    expect(rows[0]!.attention).toEqual([]);
  });

  it("count a company's warnings on each of its obras as that obra's Resumen does", async () => {
    const { admin } = await setup();
    const [one, two] = [await contracted(admin, "VTH-1"), await contracted(admin, "VTH-2")];
    // A company on both obras without its documents: its own missing ones count on each, each obra's PSS adhesion on that obra.
    const { id } = await subcontractorsService.createSubcontractor(admin, {
      kind: "company",
      legalName: "Electricidad Saja S.L.",
      taxId: "B-39123450",
      address: "C/ Ramón y Cajal 14",
      postalCode: "39300",
      city: "Torrelavega",
      trades: ["electrical"],
      headcount: 9,
      permanentCount: 6,
      preventionMode: "external_service",
    });
    for (const project of [one, two]) await subcontractorsService.assignToProject(admin, id, project.id, { chapterCodes: ["01"] });

    for (const project of [one, two]) {
      const control = await constructionService.getControl(admin, project.id);
      expect(control.documentAlerts.length).toBeGreaterThan(0);
      expect(countOf((await listed(admin, project.id))!, "documents")).toBe(control.documentAlerts.length);
    }
  });

  it("keep tenants apart", async () => {
    const { admin } = await setup();
    const theirs = await setup();
    const demo = await seeded(theirs.admin, "VTH-1");
    const mine = await contracted(admin, "VTH-1");

    expect((await listWithSignals(admin)).map((r) => r.id)).toEqual([mine.id]);
    // Asked for another tenant's obra, nothing of it is read.
    const signals = await projectSignals(admin, [{ id: demo.id, startDate: null, completionDate: null }]);
    expect(signals.get(demo.id)).toEqual({ schedule: null, progressPct: null, attention: [] });
  });

  it("take the same number of queries for one obra as for many", async () => {
    const { admin } = await setup();
    await seeded(admin, "VTH-1");
    // The first read works out the companies' stored CAE values; counted once they are.
    await listWithSignals(admin);
    const one = await queriesOf(() => listWithSignals(admin));
    for (const ref of ["VTH-2", "VTH-3", "VTH-4"]) await contracted(admin, ref);
    await createTestProject(admin.tenantId, { ref: "VTH-5" });
    const many = await queriesOf(() => listWithSignals(admin));

    expect(many).toBe(one);
    expect(many).toBeLessThanOrEqual(13);
    // Without them, the list's own three.
    expect(await queriesOf(() => svc.listProjectsWithBudget(admin))).toBe(3);
  });

  it("are left out unless asked for", async () => {
    const { admin } = await setup();
    const project = await contracted(admin, "VTH-1");

    const [row] = await svc.listProjectsWithBudget(admin);
    expect(row!.id).toBe(project.id);
    expect(row).not.toHaveProperty("schedule");
    expect(row).not.toHaveProperty("progressPct");
    expect(row).not.toHaveProperty("attention");
    expect(await svc.listProjectsWithBudget(admin, { signals: false })).toEqual([row]);
  });

  it("read the built % and the hitos without the lines, to the same figures as loadObra", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T10:00:00Z") });
    const { admin } = await setup();
    const project = await createTestProject(admin.tenantId, {
      ref: "VTH-1",
      startDate: new Date("2026-06-01T00:00:00Z"),
      completionDate: new Date("2027-03-31T00:00:00Z"),
    });
    // Margins that make every unit price round, odd quantities and prices.
    const { revisionId, chapterId } = await framerDraft(admin, project.id, [], 0, { overheadPct: 16, profitPct: 6 });
    const line = (chapter: string, code: string, quantity: number, unitPriceCents: number) =>
      budgetService.addLine(admin, project.id, chapter, { code, description: code, unit: "ud", quantity, unitPriceCents });
    await line(chapterId("01"), "01.01", 1.5, 1001);
    await line(chapterId("01"), "01.02", 2, 333);
    await line(chapterId("02"), "02.01", 3.333, 777);
    await line(chapterId("02"), "02.02", 1, 1235);
    await line(chapterId("03"), "03.01", 0.5, 999);
    await line(chapterId("03"), "03.02", 0, 500);
    const option = async (name: string, quantity: number, unitPriceCents: number) => {
      const { optionId } = await budgetOptionsService.addOption(admin, project.id, revisionId, { name });
      await line(optionId, "OP.01", quantity, unitPriceCents);
      return optionId;
    };
    const pool = await option("Piscina", 1.25, 4321);
    // A deduction priced to a negative half cent: -9,63 ÷ 0,78 = -12,35 and -1,235 × 0.5 = -617.5, which `amountCents` rounds to -617.
    const deduction = await option("Sin solado", 0.5, -963);
    await option("Pérgola", 1, 99_999);
    await budgetService.acceptRevision(admin, project.id, revisionId, { chosenOptionIds: [pool, deduction] }, { unissued: true });

    const { revision } = await budgetService.getBudget(admin, project.id, revisionId);
    const pct: Record<string, number> = { "01.01": 10, "01.02": 50, "02.01": 30, "02.02": 30, "03.01": 0, "03.02": 100 };
    const lines = [...revision!.chapters, ...revision!.options].flatMap((c) => c.lines);
    await budgetService.setProgress(admin, project.id, {
      lines: lines.map((l) => ({ id: l.id, executedPct: pct[l.code] ?? 25 })),
    });
    // Chapter 02 finished on Avance with its lines at 30 %: built in full.
    await constructionService.startChapter(admin, project.id, "02", { date: "2026-07-01" });
    await constructionService.finishChapter(admin, project.id, "02", { date: "2026-08-01" });

    const full = await loadObra(admin.tenantId, project.id);
    const lean = (await loadObraSummaries(admin.tenantId, [project.id])).get(project.id)!;
    expect(full.chapters.flatMap((c) => c.lines).map((l) => l.amountCents)).toContain(-617);
    expect(lean.contracted).toBe(true);
    expect(lean.progress).toEqual(full.progress);
    expect(lean.progress.progressPct).toBeGreaterThan(0);
    expect(lean.progress.progressPct).toBeLessThan(100);
    expect(lean.costChapters).toEqual(full.costChapters.map(({ code, name }) => ({ code, name })));
    expect(lean.hitos).toEqual(
      full.hitos.map(({ id, pctBp, chapters, invoicedOn, paidOn, dueOn }) => ({
        id,
        pctBp,
        chapters: chapters.map(({ code }) => ({ code })),
        invoicedOn,
        paidOn,
        dueOn,
      })),
    );
    expect(lean.requests).toEqual(full.requests);

    const [row, obra, control] = await Promise.all([
      listed(admin, project.id),
      obraService.getObra(admin, project.id),
      constructionService.getControl(admin, project.id),
    ]);
    expect(row!.progressPct).toBe(obra.progressPct);
    expect(row!.schedule).toEqual(projectSchedule(control.schedule));
  });

  it("give a contract with nothing to build a built % of 0, as loadObra", async () => {
    const { admin } = await setup();
    const project = await createTestProject(admin.tenantId, { ref: "VTH-1" });
    const { revisionId } = await framerDraft(admin, project.id, []);
    await budgetService.acceptRevision(admin, project.id, revisionId, {}, { unissued: true });

    const full = await loadObra(admin.tenantId, project.id);
    const lean = (await loadObraSummaries(admin.tenantId, [project.id])).get(project.id)!;
    expect(lean).toMatchObject({
      contracted: true,
      costChapters: full.costChapters.map(({ code, name }) => ({ code, name })),
      progress: full.progress,
    });
    expect((await listed(admin, project.id))!.progressPct).toBe(0);
  });
});
