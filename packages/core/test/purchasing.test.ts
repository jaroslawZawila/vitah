import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { db, eq, purchaseOrders, sql } from "@repo/db";
import { MAX_AMOUNT_CENTS, MAX_UNPAGED, orderLabel } from "../src/contract";
import {
  budgetService,
  constructionService,
  planningService,
  projectsService,
  purchaseInvoicesService,
  purchasingService as svc,
  subcontractorsService,
  type Ctx,
} from "../src";
import { addDays, todayInSpain } from "../src/obra-calc";
import { files } from "../src/testing";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));

const company = (overrides: Record<string, unknown> = {}) => ({
  kind: "company",
  legalName: "Montajes Steel Norte S.L.",
  taxId: "B39123450",
  address: "Polígono Raos 4",
  postalCode: "39600",
  city: "Maliaño",
  ...overrides,
});

/**
 * A project with dates and an accepted budget of chapters 01–03, one line of
 * 1.000 € each at cost; a subcontractor and a material supplier.
 */
async function setup(role: Ctx["role"] = "manager") {
  const tenant = await createTestTenant();
  const admin: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" };
  const user = await createTestUser(tenant.id, { role, name: "Laura Pérez" });
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role };
  const project = await createTestProject(tenant.id, {
    startDate: new Date("2026-06-01T00:00:00Z"),
    completionDate: new Date("2027-03-31T00:00:00Z"),
  });
  const { revisionId } = await framerDraft(admin, project.id, ["01", "02", "03"]);
  await budgetService.acceptRevision(admin, project.id, revisionId, {}, { unissued: true });
  const { id: subcontractorId } = await subcontractorsService.createSubcontractor(admin, company());
  const { id: supplierId } = await subcontractorsService.createSubcontractor(
    admin,
    company({ legalName: "Piedra de Liébana S.L.", taxId: "B39654322", suppliesOnly: true }),
  );
  const form = await svc.getPurchaseForm(admin, project.id);
  const lineage = (code: string) => form.chapters.find((c) => c.code === code)!.lines[0]!.lineageId;
  return { tenant, admin, ctx, project, subcontractorId, supplierId, lineage };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const material = (s: Setup, overrides: Record<string, unknown> = {}) => ({
  kind: "material",
  subcontractorId: s.supplierId,
  description: "Mampostería de piedra natural",
  expectedOn: "2026-10-30",
  lines: [{ lineageId: s.lineage("01"), amountCents: 95_000 }],
  ...overrides,
});

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

describe("createPurchase", () => {
  it("numbers the project's orders and leaves a pending one out of what is contracted", async () => {
    const s = await setup();
    const first = await svc.createPurchase(s.ctx, s.project.id, material(s));
    const second = await svc.createPurchase(s.ctx, s.project.id, material(s, { lines: [{ lineageId: s.lineage("02"), amountCents: 50_000 }] }));
    expect([first.number, second.number]).toEqual([1, 2]);

    const { orders, summary } = await svc.getProjectPurchases(s.ctx, s.project.id);
    expect(orders.map((o) => [o.number, o.status, o.amountCents, o.chapterCodes])).toEqual([
      [2, "pending", 50_000, ["02"]],
      [1, "pending", 95_000, ["01"]],
    ]);
    expect(orders[1]).toMatchObject({ supplierName: "Piedra de Liébana S.L.", suppliesOnly: true, caeStatus: "apta", orderedOn: null });
    expect(summary).toMatchObject({ costCents: 300_000, contractedCents: 0, toContractCents: 300_000, uncontractedLines: 3, pendingOrders: 2 });
  });

  it("places an order straight away, dated today unless told otherwise", async () => {
    const s = await setup();
    const { orderId } = await svc.createPurchase(s.ctx, s.project.id, material(s, { status: "ordered" }));
    expect(await svc.getPurchase(s.ctx, orderId)).toMatchObject({ status: "ordered", orderedOn: "2026-10-17", createdBy: "Laura Pérez" });

    const sub = await svc.createPurchase(s.ctx, s.project.id, {
      kind: "subcontract",
      subcontractorId: s.subcontractorId,
      description: "Montaje de la estructura",
      status: "contracted",
      orderedOn: "2026-10-10",
      workStart: "2026-11-02",
      workEnd: "2026-11-27",
      // A subcontract has no delivery date.
      expectedOn: "2026-11-01",
      lines: [{ lineageId: s.lineage("03"), amountCents: 98_000 }],
    });
    expect(await svc.getPurchase(s.ctx, sub.orderId)).toMatchObject({
      status: "contracted",
      orderedOn: "2026-10-10",
      workStart: "2026-11-02",
      expectedOn: null,
    });
  });

  it("checks the supplier, the lines and the dates", async () => {
    const s = await setup();
    const reject = (overrides: Record<string, unknown>) => svc.createPurchase(s.ctx, s.project.id, material(s, overrides));

    await expect(reject({ lines: [] })).rejects.toMatchObject({ code: "missing_fields" });
    await expect(reject({ description: "  " })).rejects.toMatchObject({ code: "missing_fields" });
    await expect(reject({ lines: [{ lineageId: "nope", amountCents: 1 }] })).rejects.toMatchObject({ code: "unknown_line" });
    await expect(reject({ lines: [{ lineageId: s.lineage("01"), amountCents: 0 }] })).rejects.toMatchObject({ code: "invalid_input" });
    const twice = { lineageId: s.lineage("01"), amountCents: 1 };
    await expect(reject({ lines: [twice, twice] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(reject({ subcontractorId: "nope" })).rejects.toMatchObject({ code: "unknown_supplier" });
    await expect(reject({ kind: "subcontract" })).rejects.toMatchObject({ code: "supplies_only" });
    await expect(reject({ status: "contracted" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(reject({ orderedOn: "2026-10-18" })).rejects.toMatchObject({ code: "invalid_date" });
    await expect(
      reject({ kind: "subcontract", subcontractorId: s.subcontractorId, workStart: "2026-11-10", workEnd: "2026-11-01" }),
    ).rejects.toMatchObject({ code: "invalid_date" });
  });

  it("numbers two orders made at once apart", async () => {
    const s = await setup();
    const made = await Promise.all([1, 2, 3].map(() => svc.createPurchase(s.ctx, s.project.id, material(s))));
    expect(made.map((m) => m.number).sort()).toEqual([1, 2, 3]);
  });
});

describe("what is contracted", () => {
  it("counts placed orders by line, and a line's deviation only once it is closed", async () => {
    const s = await setup();
    // 01: closed for 950 € (a saving of 50 €: −50); 02: 400 € so far, more to order.
    await svc.createPurchase(s.ctx, s.project.id, material(s, { status: "ordered" }));
    const open = await svc.createPurchase(s.ctx, s.project.id, {
      kind: "subcontract",
      subcontractorId: s.subcontractorId,
      description: "Colocación",
      status: "contracted",
      lines: [{ lineageId: s.lineage("02"), amountCents: 40_000, closesLine: false }],
    });

    const { summary } = await svc.getProjectPurchases(s.ctx, s.project.id);
    expect(summary).toMatchObject({
      contractedCents: 135_000,
      closedLines: 1,
      deviationCents: -5_000,
      deviationBp: -500,
      toContractCents: 100_000,
      uncontractedLines: 1,
    });

    const { chapters, sources } = await constructionService.getCosts(s.ctx, s.project.id);
    expect(sources.purchasing).toBe("live");
    expect(chapters[0]!.lines[0]).toMatchObject({
      contractedCents: 95_000,
      contracting: "closed",
      deviationCents: -5_000,
      orders: [{ number: 1, supplierName: "Piedra de Liébana S.L.", lateDays: null }],
    });
    expect(chapters[1]!.lines[0]).toMatchObject({ contractedCents: 40_000, contracting: "open", deviationCents: null });
    expect(chapters[2]!.lines[0]).toMatchObject({ contractedCents: null, contracting: "none", orders: [] });

    const control = await constructionService.getControl(s.ctx, s.project.id);
    expect(control.chapters.map((c) => [c.code, c.contractedLines, c.openLines, c.contractedCents, c.deviationCents])).toEqual([
      ["01", 1, 0, 95_000, -5_000],
      ["02", 0, 1, 40_000, null],
      ["03", 0, 0, null, null],
    ]);
    expect(control.cost).toMatchObject({ contractedCents: 135_000, contractedCostCents: 100_000, deviationCents: -5_000, deviationBp: -500 });

    // Closing 02 with the rest: its deviation is over both orders.
    await svc.createPurchase(s.ctx, s.project.id, material(s, {
      status: "ordered",
      lines: [{ lineageId: s.lineage("02"), amountCents: 65_000 }],
    }));
    const detail = await svc.getPurchase(s.ctx, open.orderId);
    expect(detail.lines[0]).toMatchObject({ code: "02.01", costCents: 100_000, amountCents: 40_000, otherCents: 65_000, deviationCents: 5_000 });
    expect((await constructionService.getCosts(s.ctx, s.project.id)).chapters[1]!.lines[0]).toMatchObject({
      contracting: "closed",
      contractedCents: 105_000,
      deviationBp: 500,
    });
  });

  it("drops a cancelled order", async () => {
    const s = await setup();
    const { orderId } = await svc.createPurchase(s.ctx, s.project.id, material(s, { status: "ordered" }));
    await svc.setPurchaseStatus(s.ctx, orderId, { status: "cancelled", note: "Pedido duplicado" });
    expect((await svc.getProjectPurchases(s.ctx, s.project.id)).summary.contractedCents).toBe(0);
  });
});

describe("setPurchaseStatus", () => {
  it("moves a material order to delivered, logging each step", async () => {
    const s = await setup();
    const { orderId } = await svc.createPurchase(s.ctx, s.project.id, material(s));
    await svc.setPurchaseStatus(s.ctx, orderId, { status: "ordered", date: "2026-10-03" });
    await svc.setPurchaseStatus(s.ctx, orderId, { status: "confirmed" });
    await svc.setPurchaseStatus(s.ctx, orderId, { status: "in_transit" });
    await expect(svc.setPurchaseStatus(s.ctx, orderId, { status: "delivered", date: "2026-10-18" })).rejects.toMatchObject({
      code: "invalid_date",
    });
    expect(await svc.setPurchaseStatus(s.ctx, orderId, { status: "delivered", date: "2026-10-16", note: "Albarán 4471" })).toEqual({
      orderId,
      status: "delivered",
    });

    const order = await svc.getPurchase(s.ctx, orderId);
    expect(order).toMatchObject({ status: "delivered", orderedOn: "2026-10-03", completedOn: "2026-10-16", budgetNumber: 0 });
    // Placing and delivering on the days they happened; the steps between on the day recorded
    // (the database's clock: only the app's Date is faked).
    const recorded = todayInSpain(new Date(vi.getRealSystemTime()));
    expect(order.reached).toEqual({
      pending: recorded,
      ordered: "2026-10-03",
      confirmed: recorded,
      in_transit: recorded,
      delivered: "2026-10-16",
    });
    expect(order.events.map((e) => [e.action, e.detail.to ?? null])).toEqual([
      ["status", "delivered"],
      ["status", "in_transit"],
      ["status", "confirmed"],
      ["status", "ordered"],
      ["created", null],
    ]);
    expect(order.events[0]).toMatchObject({ note: "Albarán 4471", by: "Laura Pérez", detail: { from: "in_transit", date: "2026-10-16" } });
  });

  it("refuses the same status, another kind's and cancelling a completed order; corrections are allowed", async () => {
    const s = await setup();
    const { orderId } = await svc.createPurchase(s.ctx, s.project.id, material(s, { status: "ordered" }));
    await expect(svc.setPurchaseStatus(s.ctx, orderId, { status: "ordered" })).rejects.toMatchObject({ code: "invalid_state" });
    await expect(svc.setPurchaseStatus(s.ctx, orderId, { status: "finished" })).rejects.toMatchObject({ code: "invalid_input" });
    await svc.setPurchaseStatus(s.ctx, orderId, { status: "delivered" });
    await expect(svc.setPurchaseStatus(s.ctx, orderId, { status: "cancelled" })).rejects.toMatchObject({ code: "invalid_state" });

    // Back to in transit: the delivery date goes.
    await svc.setPurchaseStatus(s.ctx, orderId, { status: "in_transit", note: "Entregado por error" });
    expect(await svc.getPurchase(s.ctx, orderId)).toMatchObject({ status: "in_transit", completedOn: null, orderedOn: "2026-10-17" });
  });

  it("warns about a late delivery in Compras and the Obra tab until it arrives", async () => {
    const s = await setup();
    const { orderId } = await svc.createPurchase(s.ctx, s.project.id, material(s, { status: "ordered", expectedOn: "2026-10-14" }));
    await svc.setPurchaseStatus(s.ctx, orderId, { status: "in_transit" });

    expect((await svc.getPurchase(s.ctx, orderId)).lateDays).toBe(3);
    expect((await svc.getProjectPurchases(s.ctx, s.project.id)).summary.lateDeliveries).toBe(1);
    expect((await constructionService.getControl(s.ctx, s.project.id)).lateDeliveries.map((o) => o.id)).toEqual([orderId]);
    const chapter = await constructionService.getControlChapter(s.ctx, s.project.id, "01");
    expect(chapter.orders).toMatchObject([{ id: orderId, lateDays: 3 }]);
    expect((await constructionService.getCosts(s.ctx, s.project.id)).chapters[0]!.lines[0]!.orders[0]!.lateDays).toBe(3);

    await svc.setPurchaseStatus(s.ctx, orderId, { status: "delivered" });
    expect((await constructionService.getControl(s.ctx, s.project.id)).lateDeliveries).toEqual([]);
  });
});

describe("updatePurchase", () => {
  it("changes fields and lines, logging the values before and after", async () => {
    const s = await setup();
    const { orderId } = await svc.createPurchase(s.ctx, s.project.id, material(s));
    await svc.updatePurchase(s.ctx, orderId, {
      description: "Mampostería y vierteaguas",
      expectedOn: "2026-11-04",
      lines: [
        { lineageId: s.lineage("01"), amountCents: 97_000 },
        { lineageId: s.lineage("03"), amountCents: 20_000, closesLine: false },
      ],
    });
    // Nothing changed: nothing logged.
    await svc.updatePurchase(s.ctx, orderId, { description: "Mampostería y vierteaguas" });

    const order = await svc.getPurchase(s.ctx, orderId);
    expect(order).toMatchObject({ description: "Mampostería y vierteaguas", expectedOn: "2026-11-04", amountCents: 117_000, chapterCodes: ["01", "03"] });
    // Logged in one transaction: the same time, so found by action.
    const updated = order.events.find((e) => e.action === "updated");
    const lines = order.events.find((e) => e.action === "lines");
    expect(updated).toMatchObject({
      action: "updated",
      detail: { fields: { description: { from: "Mampostería de piedra natural", to: "Mampostería y vierteaguas" }, expectedOn: { from: "2026-10-30", to: "2026-11-04" } } },
    });
    expect(lines).toMatchObject({
      action: "lines",
      detail: {
        changes: [
          { code: "01.01", from: { amountCents: 95_000, closesLine: true }, to: { amountCents: 97_000, closesLine: true } },
          { code: "03.01", from: null, to: { amountCents: 20_000, closesLine: false } },
        ],
      },
    });
    expect(order.events).toHaveLength(3);
  });

  it("changes the kind only while pending, and keeps a supplier's own kind", async () => {
    const s = await setup();
    const { orderId } = await svc.createPurchase(s.ctx, s.project.id, material(s));
    await expect(svc.updatePurchase(s.ctx, orderId, { kind: "subcontract" })).rejects.toMatchObject({ code: "supplies_only" });
    await svc.updatePurchase(s.ctx, orderId, { kind: "subcontract", subcontractorId: s.subcontractorId, workStart: "2026-11-02" });
    expect(await svc.getPurchase(s.ctx, orderId)).toMatchObject({ kind: "subcontract", expectedOn: null, workStart: "2026-11-02" });

    await svc.setPurchaseStatus(s.ctx, orderId, { status: "contracted" });
    await expect(svc.updatePurchase(s.ctx, orderId, { kind: "material" })).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("gives the form what the other orders contracted, without the one edited", async () => {
    const s = await setup();
    const { orderId } = await svc.createPurchase(s.ctx, s.project.id, material(s, { status: "ordered" }));
    const line = (form: Awaited<ReturnType<typeof svc.getPurchaseForm>>) => form.chapters[0]!.lines[0]!;

    const form = await svc.getPurchaseForm(s.ctx, s.project.id);
    expect(form).toMatchObject({ nextNumber: 2, ref: s.project.ref });
    expect(line(form)).toMatchObject({ code: "01.01", costCents: 100_000, contractedCents: 95_000, closed: true });
    expect(form.suppliers.map((x) => [x.legalName, x.suppliesOnly, x.status])).toEqual([
      ["Montajes Steel Norte S.L.", false, "pendiente"],
      ["Piedra de Liébana S.L.", true, "apta"],
    ]);
    expect(form.suppliers[0]!.missing.length).toBeGreaterThan(0);
    expect(form.editing).toBeNull();
    const editing = await svc.getPurchaseForm(s.ctx, s.project.id, orderId);
    expect(line(editing)).toMatchObject({ contractedCents: 0, closed: false });
    expect(editing.editing).toMatchObject({ id: orderId, number: 1, status: "ordered", lines: [{ lineageId: s.lineage("01"), amountCents: 95_000, closesLine: true }] });
    await expect(svc.getPurchaseForm(s.ctx, s.project.id, "nope")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("listPurchases", () => {
  it("lists every project's orders with the year's totals, and one supplier's", async () => {
    const s = await setup();
    const other = await createTestProject(s.tenant.id);
    const { revisionId } = await framerDraft(s.admin, other.id, ["01"]);
    await budgetService.acceptRevision(s.admin, other.id, revisionId, {}, { unissued: true });
    const otherLine = (await svc.getPurchaseForm(s.ctx, other.id)).chapters[0]!.lines[0]!.lineageId;

    await svc.createPurchase(s.ctx, s.project.id, material(s, { status: "ordered", expectedOn: "2026-10-10" }));
    await svc.createPurchase(s.ctx, other.id, {
      kind: "subcontract",
      subcontractorId: s.subcontractorId,
      description: "Montaje",
      lines: [{ lineageId: otherLine, amountCents: 80_000 }],
    });

    const all = await svc.listPurchases(s.ctx);
    expect(all.orders.map((o) => [o.projectRef, o.number])).toEqual([
      [other.ref, 1],
      [s.project.ref, 1],
    ]);
    expect(all.summary).toEqual({
      yearContractedCents: 95_000,
      yearOrders: 1,
      yearProjects: 1,
      openCents: 95_000,
      openOrders: 1,
      pendingCents: 80_000,
      pendingOrders: 1,
      lateDeliveries: 1,
      lateProjectRefs: [s.project.ref],
    });
    expect(all.projects.map((p) => p.ref).sort()).toEqual([s.project.ref, other.ref].sort());
    expect((await svc.listSupplierOrders(s.ctx, s.subcontractorId)).map((o) => o.projectRef)).toEqual([other.ref]);
    await expect(svc.listSupplierOrders(s.ctx, "nope")).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("listPurchases, a page at a time", () => {
  /**
   * Seven orders on two obras, read by a viewer: on the first a late delivery
   * (PED-001), a subcontract (002), one not sent (003), one delivered (004)
   * and one cancelled (005); on the second a subcontract not sent (001) and
   * an order placed last year (002). Besides, an order of a deleted obra and
   * one of another tenant, which nothing may show.
   */
  async function many() {
    const s = await setup("viewer");
    const { admin } = s;
    const budgeted = async (ctx: Ctx, tenantId: string) => {
      const project = await createTestProject(tenantId);
      const { revisionId } = await framerDraft(ctx, project.id, ["01"]);
      await budgetService.acceptRevision(ctx, project.id, revisionId, {}, { unissued: true });
      return { project, lineageId: (await svc.getPurchaseForm(ctx, project.id)).chapters[0]!.lines[0]!.lineageId };
    };
    const order = async (ctx: Ctx, projectId: string, input: Record<string, unknown>) => (await svc.createPurchase(ctx, projectId, input)).orderId;

    const a1 = await order(admin, s.project.id, material(s, { description: "Mampostería de piedra", status: "ordered", orderedOn: "2026-10-03", expectedOn: "2026-10-10" }));
    const a2 = await order(admin, s.project.id, {
      kind: "subcontract",
      subcontractorId: s.subcontractorId,
      description: "Montaje de la estructura",
      status: "contracted",
      orderedOn: "2026-09-15",
      lines: [{ lineageId: s.lineage("03"), amountCents: 98_000 }],
    });
    const a3 = await order(admin, s.project.id, material(s, { description: "Hormigón de limpieza", lines: [{ lineageId: s.lineage("02"), amountCents: 50_000 }] }));
    const a4 = await order(admin, s.project.id, material(s, { description: "Lámina 100% impermeable", status: "ordered", orderedOn: "2026-08-01", lines: [{ lineageId: s.lineage("02"), amountCents: 20_000 }] }));
    await svc.setPurchaseStatus(admin, a4, { status: "delivered", date: "2026-08-20" });
    const a5 = await order(admin, s.project.id, material(s, { description: "Oferta descartada", lines: [{ lineageId: s.lineage("01"), amountCents: 10_000 }] }));
    await svc.setPurchaseStatus(admin, a5, { status: "cancelled" });

    const second = await budgeted(admin, s.tenant.id);
    const b1 = await order(admin, second.project.id, {
      kind: "subcontract",
      subcontractorId: s.subcontractorId,
      description: "Montaje en la otra obra",
      lines: [{ lineageId: second.lineageId, amountCents: 80_000 }],
    });
    const b2 = await order(admin, second.project.id, material(s, { description: "Ventanas", status: "ordered", orderedOn: "2025-12-20", expectedOn: "2026-12-01", lines: [{ lineageId: second.lineageId, amountCents: 30_000 }] }));

    // An obra deleted with its order, late and placed this year: it counts nowhere.
    const gone = await budgeted(admin, s.tenant.id);
    await order(admin, gone.project.id, material(s, { description: "Piedra de la obra borrada", status: "ordered", expectedOn: "2026-10-01", lines: [{ lineageId: gone.lineageId, amountCents: 77_000 }] }));
    await projectsService.deleteProject(admin, gone.project.id);

    const otherTenant = await createTestTenant();
    const stranger: Ctx = { tenantId: otherTenant.id, userId: (await createTestUser(otherTenant.id, { role: "admin" })).id, role: "admin" };
    const theirs = await budgeted(stranger, otherTenant.id);
    const { id: theirSupplier } = await subcontractorsService.createSubcontractor(stranger, company({ legalName: "Piedra Ajena S.L.", suppliesOnly: true }));
    const strangerOrder = await order(stranger, theirs.project.id, {
      kind: "material",
      subcontractorId: theirSupplier,
      description: "Piedra de otro",
      status: "ordered",
      expectedOn: "2026-10-01",
      lines: [{ lineageId: theirs.lineageId, amountCents: 66_000 }],
    });
    // Newest first.
    return { ...s, second: second.project, gone: gone.project, stranger, strangerOrder, theirProject: theirs.project, ids: [b2, b1, a5, a4, a3, a2, a1] };
  }

  const idsOf = (list: { orders: { id: string }[] }) => list.orders.map((o) => o.id);

  it("gives the whole list when no page is asked for, as before", async () => {
    const s = await many();
    const all = await svc.listPurchases(s.ctx);

    expect(idsOf(all)).toEqual(s.ids);
    expect(all.paging).toEqual({ page: 1, limit: 5000, total: 7, pages: 1 });
    expect(all.groupCounts).toEqual({ all: 7, open: 3, pending: 2, done: 1, cancelled: 1 });
    // 95.000 + 98.000 + 20.000 + 30.000: pending and cancelled ones don't add up.
    expect(all.shownContractedCents).toBe(243_000);
    expect(all.suppliers).toEqual([
      { id: s.subcontractorId, name: "Montajes Steel Norte S.L." },
      { id: s.supplierId, name: "Piedra de Liébana S.L." },
    ]);
    expect(all.bySupplier).toBeUndefined();
    // The order placed in 2025 isn't this year's; the deleted obra's and the other tenant's count nowhere.
    expect(all.summary).toEqual({
      yearContractedCents: 213_000,
      yearOrders: 3,
      yearProjects: 1,
      openCents: 223_000,
      openOrders: 3,
      pendingCents: 130_000,
      pendingOrders: 2,
      lateDeliveries: 1,
      lateProjectRefs: [s.project.ref],
    });
    expect(all.projects.map((p) => p.id).sort()).toEqual([s.project.id, s.second.id].sort());
    expect(all.orders.at(-1)).toMatchObject({ number: 1, amountCents: 95_000, lateDays: 7, caeStatus: "apta", chapterCodes: ["01"] });
    expect(all.orders.find((o) => o.id === s.ids[5])).toMatchObject({ caeStatus: "pendiente", supplierName: "Montajes Steel Norte S.L." });
  });

  it("says when a list asked for whole was cut at its cap, and exports every order all the same", async () => {
    const s = await setup("viewer");
    const total = MAX_UNPAGED + 1;
    // One more order than a whole list returns, each a second older than the last.
    await db.execute(sql`
      insert into purchase_orders (id, tenant_id, project_id, number, kind, subcontractor_id, description, status, ordered_on, created_at)
      select gen_random_uuid()::text, ${s.tenant.id}, ${s.project.id}, n, 'material', ${s.supplierId}, 'Pedido ' || n, 'ordered', '2026-09-01',
        now() - make_interval(secs => n)
      from generate_series(1, ${total}) n`);

    const whole = await svc.listPurchases(s.ctx);
    expect(whole.orders).toHaveLength(MAX_UNPAGED);
    expect(whole.paging).toEqual({ page: 1, limit: MAX_UNPAGED, total, pages: 2, truncated: true });
    // The oldest is the one the cap left out.
    expect(whole.orders.map((o) => o.number)).not.toContain(total);

    // The export reads the pages in turn: every order, once, in the list's order.
    const exported = await svc.listAllPurchases(s.ctx);
    expect(exported).toHaveLength(total);
    expect(exported.map((o) => o.number)).toEqual(Array.from({ length: total }, (_, i) => i + 1));
    // With the screen's filters, and whatever page or breakdown came along with them.
    const filtered = await svc.listAllPurchases(s.ctx, { q: "Pedido 500", ...({ page: 3, limit: 1, by: "supplier" } as object) });
    expect(filtered.map((o) => o.number).sort((a, b) => a - b)).toEqual([500, 5000, 5001]);
    expect(await svc.listAllPurchases(s.ctx, { group: "pending" })).toEqual([]);

    // A list that fits says nothing of the kind, and a page never does.
    expect((await svc.listPurchases(s.ctx, { q: "Pedido 500" })).paging).toEqual({ page: 1, limit: MAX_UNPAGED, total: 3, pages: 1 });
    expect((await svc.listPurchases(s.ctx, { page: 1 })).paging).toEqual({ page: 1, limit: 50, total, pages: Math.ceil(total / 50) });
  }, 120_000);

  it("cuts pages in a stable order: first, next, last and beyond the end", async () => {
    const s = await many();
    const page = (n: number) => svc.listPurchases(s.ctx, { page: n, limit: 3 });

    const [first, next, last, beyond] = await Promise.all([page(1), page(2), page(3), page(4)]);
    expect(idsOf(first)).toEqual(s.ids.slice(0, 3));
    expect(idsOf(next)).toEqual(s.ids.slice(3, 6));
    expect(idsOf(last)).toEqual(s.ids.slice(6));
    expect(idsOf(beyond)).toEqual([]);
    expect(first.paging).toEqual({ page: 1, limit: 3, total: 7, pages: 3 });
    expect(beyond.paging).toEqual({ page: 4, limit: 3, total: 7, pages: 3 });
    // The counts and the totals are the whole list's on every page.
    for (const each of [first, next, last, beyond]) {
      expect(each.groupCounts).toEqual({ all: 7, open: 3, pending: 2, done: 1, cancelled: 1 });
      expect(each.shownContractedCents).toBe(243_000);
      expect(each.summary).toMatchObject({ yearContractedCents: 213_000, openOrders: 3, lateDeliveries: 1 });
    }
    // As a URL carries them, and a page with the default size.
    expect(idsOf(await svc.listPurchases(s.ctx, { page: "2", limit: "3" }))).toEqual(s.ids.slice(3, 6));
    expect((await svc.listPurchases(s.ctx, { page: 1 })).paging).toEqual({ page: 1, limit: 50, total: 7, pages: 1 });
  });

  it("caps a huge limit and refuses a page that isn't one", async () => {
    const s = await many();
    expect((await svc.listPurchases(s.ctx, { limit: 1_000_000 })).paging).toMatchObject({ limit: 200, total: 7 });
    for (const bad of [{ page: 0 }, { page: "abc" }, { page: -1 }, { page: 1.5 }, { limit: 0 }, { limit: "x" }]) {
      await expect(svc.listPurchases(s.ctx, bad)).rejects.toMatchObject({ code: "invalid_page", status: 400 });
    }
    await expect(svc.listPurchases(s.ctx, { group: "nope" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.listPurchases(s.ctx, { kind: "nope" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.listPurchases(s.ctx, { from: "2026-02-31" })).rejects.toMatchObject({ code: "invalid_date" });
  });

  it("filters on the server: state, obra, supplier, type, order date, lateness and text", async () => {
    const s = await many();
    const [b2, b1, a5, a4, a3, a2, a1] = s.ids;
    const kept = async (query: Record<string, unknown>) => idsOf(await svc.listPurchases(s.ctx, { page: 1, ...query }));

    expect(await kept({ group: "open" })).toEqual([b2, a2, a1]);
    expect(await kept({ group: "pending" })).toEqual([b1, a3]);
    expect(await kept({ group: "done" })).toEqual([a4]);
    expect(await kept({ group: "cancelled" })).toEqual([a5]);
    expect(await kept({ group: "all" })).toEqual(s.ids);
    expect(await kept({ projectId: s.second.id })).toEqual([b2, b1]);
    expect(await kept({ supplierId: s.subcontractorId })).toEqual([b1, a2]);
    expect(await kept({ kind: "subcontract" })).toEqual([b1, a2]);
    expect(await kept({ kind: "material", group: "open" })).toEqual([b2, a1]);
    expect(await kept({ from: "2026-10-01", to: "2026-10-05" })).toEqual([a1]);
    expect(await kept({ from: "2026-08-01", to: "2026-09-30" })).toEqual([a4, a2]);
    expect(await kept({ to: "2025-12-31" })).toEqual([b2]);
    expect(await kept({ late: "1" })).toEqual([a1]);
    expect(await kept({ late: true, projectId: s.second.id })).toEqual([]);
    // Text: in the number, the supplier, the description or the obra, whatever its case.
    expect(await kept({ q: "MONTAJE" })).toEqual([b1, a2]);
    expect(await kept({ q: "ped-002" })).toEqual([b2, a2]);
    expect(await kept({ q: "steel norte" })).toEqual([b1, a2]);
    expect(await kept({ q: s.second.ref })).toEqual([b2, b1]);
    expect(await kept({ q: "  hormigón " })).toEqual([a3]);
    // % and _ are text, not wildcards.
    expect(await kept({ q: "100%" })).toEqual([a4]);
    expect(await kept({ q: "1_0" })).toEqual([]);
    expect(await kept({ q: "%" })).toEqual([a4]);
    // The deleted obra's order never matches, nor another tenant's obra or supplier.
    expect(await kept({ q: "borrada" })).toEqual([]);
    expect(await kept({ projectId: s.gone.id })).toEqual([]);
    expect(await kept({ projectId: s.theirProject.id })).toEqual([]);
  });

  it("finds an order by its number as the list shows it, short or long: PED-007, PED-123, PED-1000", async () => {
    const s = await many();
    const [, , , , a3, a2, a1] = s.ids;
    const renumber = (id: string, number: number) => db.update(purchaseOrders).set({ number }).where(eq(purchaseOrders.id, id));
    await renumber(a1!, 7);
    await renumber(a2!, 123);
    await renumber(a3!, 1000);
    const kept = async (q: string) => idsOf(await svc.listPurchases(s.ctx, { page: 1, projectId: s.project.id, q }));
    const shown = (await svc.listPurchases(s.ctx, { page: 1, projectId: s.project.id })).orders;

    // What the list shows for each is what finds it.
    for (const [id, label] of [[a1, "PED-007"], [a2, "PED-123"], [a3, "PED-1000"]] as const) {
      expect(orderLabel(shown.find((o) => o.id === id)!.number)).toBe(label);
      expect(await kept(label)).toEqual([id]);
      expect(await kept(label.toLowerCase())).toEqual([id]);
    }
    // A number past 999 is not cut to three digits: PED-1000 is no PED-100, and has no zero in front.
    expect(await kept("PED-100")).toEqual([a3]);
    expect(await kept("PED-0100")).toEqual([]);
    expect(await kept("PED-01000")).toEqual([]);
    expect(await kept("PED-0123")).toEqual([]);
    expect(await kept("PED-0007")).toEqual([]);
    expect(await kept("PED-12")).toEqual([a2]);
  });

  it("counts and totals the filtered orders, whatever page and state are shown", async () => {
    const s = await many();
    const material_ = await svc.listPurchases(s.ctx, { page: 1, limit: 2, kind: "material", group: "open" });
    // Material: PED-001 late, 003 not sent, 004 delivered, 005 cancelled, and the second obra's 002.
    expect(material_.groupCounts).toEqual({ all: 5, open: 2, pending: 1, done: 1, cancelled: 1 });
    expect(material_.paging).toEqual({ page: 1, limit: 2, total: 2, pages: 1 });
    expect(material_.shownContractedCents).toBe(125_000);
    // The KPIs stay the whole tenant's.
    expect(material_.summary).toMatchObject({ openCents: 223_000, openOrders: 3, pendingOrders: 2 });

    expect((await svc.listPurchases(s.ctx, { page: 1, group: "pending" })).shownContractedCents).toBe(0);
    expect((await svc.listPurchases(s.ctx, { page: 1, q: "nada de nada" }))).toMatchObject({
      orders: [],
      paging: { total: 0, pages: 1 },
      groupCounts: { all: 0, open: 0, pending: 0, done: 0, cancelled: 0 },
      shownContractedCents: 0,
    });
  });

  it("groups the filtered orders by supplier when asked, the most contracted first", async () => {
    const s = await many();
    const { bySupplier } = await svc.listPurchases(s.ctx, { page: 1, by: "supplier" });
    expect(bySupplier).toEqual([
      {
        id: s.supplierId,
        name: "Piedra de Liébana S.L.",
        suppliesOnly: true,
        orders: 5,
        projectRefs: [s.project.ref, s.second.ref].sort(),
        contractedCents: 145_000,
        openCents: 125_000,
      },
      { id: s.subcontractorId, name: "Montajes Steel Norte S.L.", suppliesOnly: false, orders: 2, projectRefs: [s.project.ref, s.second.ref].sort(), contractedCents: 98_000, openCents: 98_000 },
    ]);
    expect((await svc.listPurchases(s.ctx, { page: 1, by: "supplier", group: "pending", projectId: s.project.id })).bySupplier).toEqual([
      { id: s.supplierId, name: "Piedra de Liébana S.L.", suppliesOnly: true, orders: 1, projectRefs: [s.project.ref], contractedCents: 0, openCents: 0 },
    ]);
  });

  it("keeps tenants apart", async () => {
    const s = await many();
    const theirs = await svc.listPurchases(s.stranger, { page: 1 });
    expect(idsOf(theirs)).toEqual([s.strangerOrder]);
    expect(theirs).toMatchObject({
      paging: { total: 1 },
      groupCounts: { all: 1, open: 1 },
      suppliers: [{ name: "Piedra Ajena S.L." }],
      summary: { openCents: 66_000, lateDeliveries: 1, lateProjectRefs: [s.theirProject.ref] },
    });
    // Asking for another tenant's obra or supplier finds nothing of it.
    expect(idsOf(await svc.listPurchases(s.stranger, { page: 1, projectId: s.project.id }))).toEqual([]);
    expect(idsOf(await svc.listPurchases(s.stranger, { page: 1, supplierId: s.supplierId }))).toEqual([]);
  });
});

describe("upcoming", () => {
  it("lists chapters under way or starting soon with lines nobody ordered, and their pending orders", async () => {
    const s = await setup();
    await constructionService.startChapter(s.ctx, s.project.id, "02", { date: "2026-10-01" });
    const { orderId } = await svc.createPurchase(s.ctx, s.project.id, material(s, { lines: [{ lineageId: s.lineage("02"), amountCents: 1_000 }] }));

    const { upcoming } = await svc.getProjectPurchases(s.ctx, s.project.id);
    expect(upcoming.find((u) => u.code === "02")).toMatchObject({
      state: "in_progress",
      uncontractedLines: 1,
      uncontractedCostCents: 100_000,
      pendingOrders: [{ id: orderId, number: 1 }],
    });

    // Fully contracted: no longer upcoming.
    await svc.setPurchaseStatus(s.ctx, orderId, { status: "ordered" });
    expect((await svc.getProjectPurchases(s.ctx, s.project.id)).upcoming.some((u) => u.code === "02")).toBe(false);
  });

  it("orders by the date each chapter's orders must go out: its planned start less the standard lead time", async () => {
    const s = await setup();
    const { upcoming } = await svc.getProjectPurchases(s.ctx, s.project.id);
    for (const chapter of upcoming) {
      const lead = { "01": 7, "02": 14, "03": 42 }[chapter.code]!;
      expect(chapter).toMatchObject({ leadDays: lead, orderBy: addDays(chapter.plannedStart!, -lead) });
    }
  });

  it("follows the plan's lead times, soonest first, and says how late an order is", async () => {
    const s = await setup();
    // 01 starts Monday 19 October, 02 on 2 November, 03 on 7 December; 03 is ordered three months ahead.
    await planningService.createPlanningDraft(s.ctx, s.project.id, {
      from: "template",
      startDate: "2026-10-19",
      region: null,
      augustClosure: false,
      christmasClosure: false,
    });
    const draft = await planningService.getPlanningDraft(s.ctx, s.project.id);
    await planningService.approvePlanningDraft(s.ctx, s.project.id, {
      items: draft.rows.map((r) => (r.code === "03" ? { ...r, leadDays: 90 } : r)),
    });

    const { upcoming, sources } = await svc.getProjectPurchases(s.ctx, s.project.id);
    expect(sources.planning).toBe("live");
    expect(upcoming.map((u) => [u.code, u.plannedStart, u.leadDays, u.orderBy, u.orderLateDays])).toEqual([
      ["03", "2026-12-07", 90, "2026-09-08", 39],
      ["01", "2026-10-19", 7, "2026-10-12", 5],
      ["02", "2026-11-02", 14, "2026-10-19", null],
    ]);
    expect((await svc.getPurchaseForm(s.ctx, s.project.id)).chapters.find((c) => c.code === "02")?.orderBy).toBe("2026-10-19");
  });
});

describe("access", () => {
  it("lets viewers read but not write", async () => {
    const s = await setup("viewer");
    const { orderId } = await svc.createPurchase(s.admin, s.project.id, material(s));
    expect((await svc.getPurchase(s.ctx, orderId)).id).toBe(orderId);
    await expect(svc.createPurchase(s.ctx, s.project.id, material(s))).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.setPurchaseStatus(s.ctx, orderId, { status: "ordered" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.updatePurchase(s.ctx, orderId, { notes: "x" })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("keeps tenants apart", async () => {
    const s = await setup();
    const { orderId } = await svc.createPurchase(s.ctx, s.project.id, material(s));
    const otherTenant = await createTestTenant();
    const intruder: Ctx = { tenantId: otherTenant.id, userId: (await createTestUser(otherTenant.id, { role: "admin" })).id, role: "admin" };

    await expect(svc.getPurchase(intruder, orderId)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.setPurchaseStatus(intruder, orderId, { status: "ordered" })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.getProjectPurchases(intruder, s.project.id)).rejects.toMatchObject({ code: "project_not_found" });
    await expect(svc.createPurchase(intruder, s.project.id, material(s))).rejects.toMatchObject({ code: "project_not_found" });
    expect((await svc.listPurchases(intruder)).orders).toEqual([]);

    // Another tenant's supplier can't take this tenant's order.
    const own = await createTestProject(otherTenant.id);
    await expect(svc.createPurchase(intruder, own.id, material(s))).rejects.toMatchObject({ code: "unknown_supplier" });
  });
});

describe("seedPurchasing", () => {
  it("contracts the demo obra's chapters built or under way, with a late delivery and orders not sent", async () => {
    const { seedObra, seedControl } = await import("../src/seed/seed-obra");
    const { seedSubcontractors } = await import("../src/seed/subcontractors");
    const { seedPurchasing } = await import("../src/seed/purchasing");
    const tenant = await createTestTenant();
    const admin: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" };
    const project = await createTestProject(tenant.id, {
      startDate: new Date("2026-03-10T00:00:00Z"),
      completionDate: new Date("2027-01-15T00:00:00Z"),
    });
    await seedObra(admin, project.id);
    await seedControl(admin, project.id);
    await seedSubcontractors(admin, project.id, { files: false });

    expect(await seedPurchasing(admin, project.id)).toBeGreaterThan(5);
    // Once only.
    expect(await seedPurchasing(admin, project.id)).toBe(0);

    const { orders, summary } = await svc.getProjectPurchases(admin, project.id);
    expect(summary.lateDeliveries).toBe(1);
    expect(summary.pendingOrders).toBeGreaterThan(0);
    expect(summary.closedLines).toBeGreaterThan(0);
    expect(orders.find((o) => o.lateDays !== null)).toMatchObject({ supplierName: "Piedra de Liébana S.L.", status: "in_transit", lateDays: 3 });

    const costs = await constructionService.getCosts(admin, project.id);
    const contracting = (code: string) => costs.chapters.find((c) => c.code === code)!.lines.map((l) => l.contracting);
    expect(contracting("01").every((c) => c === "closed")).toBe(true);
    expect(contracting("06")).toEqual(expect.arrayContaining(["closed", "open", "none"]));
    expect(contracting("12").every((c) => c === "none")).toBe(true);
  });
});

describe("code review fixes", () => {
  it("shows no contracted amount or deviation on a cancelled order's page", async () => {
    const s = await setup();
    const { orderId } = await svc.createPurchase(s.ctx, s.project.id, material(s, { status: "ordered" }));
    expect((await svc.getPurchase(s.ctx, orderId)).lines[0]).toMatchObject({ deviationCents: -5_000 });
    await svc.setPurchaseStatus(s.ctx, orderId, { status: "cancelled" });
    expect((await svc.getPurchase(s.ctx, orderId)).lines[0]).toMatchObject({ otherCents: 0, deviationCents: null });
    // And it's history: reopen it to change it.
    await expect(svc.updatePurchase(s.ctx, orderId, { notes: "x" })).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("never completes an order before it was placed", async () => {
    const s = await setup();
    const { orderId } = await svc.createPurchase(s.ctx, s.project.id, material(s, { status: "ordered", orderedOn: "2026-10-10" }));
    await expect(svc.setPurchaseStatus(s.ctx, orderId, { status: "delivered", date: "2026-10-01" })).rejects.toMatchObject({
      code: "invalid_date",
    });
    // Delivered straight from pending: placed that day too.
    const pending = await svc.createPurchase(s.ctx, s.project.id, material(s));
    await svc.setPurchaseStatus(s.ctx, pending.orderId, { status: "delivered", date: "2026-09-01" });
    expect(await svc.getPurchase(s.ctx, pending.orderId)).toMatchObject({ orderedOn: "2026-09-01", completedOn: "2026-09-01" });
  });

  it("keeps a company with subcontracts from becoming a material supplier", async () => {
    const s = await setup();
    await svc.createPurchase(s.ctx, s.project.id, {
      kind: "subcontract",
      subcontractorId: s.subcontractorId,
      description: "Montaje",
      lines: [{ lineageId: s.lineage("03"), amountCents: 1 }],
    });
    await expect(subcontractorsService.updateSubcontractor(s.admin, s.subcontractorId, { suppliesOnly: true })).rejects.toMatchObject({
      code: "supplies_only",
    });
  });
});

describe("input boundaries (schemas in src/inputs/purchasing.ts)", () => {
  const OVER = MAX_AMOUNT_CENTS + 1;
  /** The code a write is refused with, or "ok". */
  const outcome = (write: Promise<unknown>) => write.then(() => "ok", (error: { code?: string }) => error.code ?? String(error));

  it("answers over-maximum amounts and wrong types with each field's code, as before, writing nothing", async () => {
    const s = await setup();
    const line = (overrides: Record<string, unknown>) => [{ lineageId: s.lineage("01"), amountCents: 1_000, ...overrides }];
    const create: [Record<string, unknown>, string][] = [
      [{ lines: line({ amountCents: OVER }) }, "invalid_input"],
      [{ lines: line({ amountCents: 2 ** 31 }) }, "invalid_input"],
      [{ lines: line({ amountCents: "1000" }) }, "invalid_input"],
      [{ lines: line({ amountCents: 10.5 }) }, "invalid_input"],
      [{ lines: line({ closesLine: "yes" }) }, "invalid_input"],
      [{ lines: line({ lineageId: 1 }) }, "invalid_input"],
      [{ lines: ["x"] }, "invalid_input"],
      [{ lines: "all" }, "missing_fields"],
      [{ lines: undefined }, "missing_fields"],
      [{ lines: Array.from({ length: 201 }, (_, i) => ({ lineageId: `l${i}`, amountCents: 1 })) }, "invalid_input"],
      [{ kind: null }, "invalid_input"],
      [{ kind: "service" }, "invalid_input"],
      [{ subcontractorId: 5 }, "missing_fields"],
      [{ subcontractorId: "" }, "missing_fields"],
      [{ requestId: "" }, "invalid_input"],
      [{ requestId: 5 }, "invalid_input"],
      [{ status: null }, "invalid_input"],
      [{ status: "delivered" }, "invalid_input"],
      [{ description: 5 }, "missing_fields"],
      [{ description: "x".repeat(501) }, "invalid_input"],
      [{ orderedOn: 20261001 }, "invalid_date"],
      [{ expectedOn: "2026-02-31" }, "invalid_date"],
      [{ notes: 5 }, "invalid_input"],
      [{ paymentDays: "30" }, "invalid_input"],
      [{ paymentDays: Number.NaN }, "invalid_input"],
      [{ retentionBp: -1 }, "invalid_input"],
      [{ vatKind: "vat4" }, "invalid_input"],
    ];
    for (const [overrides, code] of create) {
      expect([overrides, await outcome(svc.createPurchase(s.ctx, s.project.id, material(s, overrides)))]).toEqual([overrides, code]);
    }
    expect(await db.select().from(purchaseOrders)).toHaveLength(0);

    const { orderId } = await svc.createPurchase(s.ctx, s.project.id, material(s, { status: "ordered" }));
    const edit: [Record<string, unknown>, string][] = [
      [{ lines: line({ amountCents: OVER }) }, "invalid_input"],
      [{ lines: null }, "missing_fields"],
      [{ kind: null }, "invalid_input"],
      [{ subcontractorId: 5 }, "missing_fields"],
      [{ description: null }, "missing_fields"],
      [{ workStart: 5 }, "invalid_date"],
      [{ retentionBp: 1.5 }, "invalid_input"],
      // The kind first: a placed order keeps it, whatever else is wrong.
      [{ kind: "subcontract", description: null }, "invalid_state"],
    ];
    for (const [input, code] of edit) {
      expect([input, await outcome(svc.updatePurchase(s.ctx, orderId, input))]).toEqual([input, code]);
    }
    const status: [Record<string, unknown>, string][] = [
      [{ status: "contracted" }, "invalid_input"],
      [{ status: null }, "invalid_input"],
      [{ status: "delivered", date: 5 }, "invalid_date"],
      [{ status: "delivered", date: "2026-10-18" }, "invalid_date"],
      [{ status: "delivered", note: 5 }, "invalid_input"],
      // The status first: the one it has is refused, whatever else is wrong.
      [{ status: "ordered", date: "nope" }, "invalid_state"],
    ];
    for (const [input, code] of status) {
      expect([input, await outcome(svc.setPurchaseStatus(s.ctx, orderId, input))]).toEqual([input, code]);
    }
    const order = await svc.getPurchase(s.ctx, orderId);
    expect(order).toMatchObject({ status: "ordered", amountCents: 95_000, description: "Mampostería de piedra natural" });
    expect(order.events.map((e) => e.action)).toEqual(["created"]);

    await expect(svc.listPurchases(s.ctx, { group: "nope" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.listPurchases(s.ctx, { kind: 5 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(svc.listPurchases(s.ctx, { from: "2026-13-01" })).rejects.toMatchObject({ code: "invalid_date" });
    expect((await svc.listPurchases(s.ctx, { group: "", kind: "", to: null, late: "no" })).orders).toHaveLength(1);
  });

  it("ignores keys it doesn't take, as before", async () => {
    const s = await setup();
    const extra = { tenantId: "other", projectId: "other", number: 42, createdById: "someone", completedOn: "2026-01-01", extra: true };
    const { orderId, number } = await svc.createPurchase(s.ctx, s.project.id, material(s, extra));
    expect(number).toBe(1);
    const [row] = await db.select().from(purchaseOrders).where(eq(purchaseOrders.id, orderId));
    expect(row).toMatchObject({ tenantId: s.tenant.id, projectId: s.project.id, number: 1, createdById: s.ctx.userId, completedOn: null });

    await svc.updatePurchase(s.ctx, orderId, { ...extra, status: "delivered", notes: " Revisado " });
    await svc.setPurchaseStatus(s.ctx, orderId, { ...extra, status: "ordered", kind: "subcontract" });
    expect(await svc.getPurchase(s.ctx, orderId)).toMatchObject({ kind: "material", status: "ordered", notes: "Revisado", number: 1 });
  });

  it("looks the supplier up before the lines and the order's fields, as before", async () => {
    const s = await setup();
    // A material supplier can't take a subcontract (409), whatever else is wrong.
    expect(await outcome(svc.createPurchase(s.ctx, s.project.id, material(s, { kind: "subcontract", description: "", lines: [] })))).toBe(
      "supplies_only",
    );
    expect(await outcome(svc.createPurchase(s.ctx, s.project.id, material(s, { subcontractorId: "nope", description: "" })))).toBe(
      "unknown_supplier",
    );
    const { orderId } = await svc.createPurchase(s.ctx, s.project.id, material(s));
    expect(await outcome(svc.updatePurchase(s.ctx, orderId, { kind: "subcontract", description: null }))).toBe("supplies_only");
    expect(await outcome(svc.updatePurchase(s.ctx, orderId, { subcontractorId: "nope", lines: [] }))).toBe("unknown_supplier");
    expect(await db.select().from(purchaseOrders)).toHaveLength(1);
  });

  it("refuses an edit whose rise its payment schedule can't store as one milestone (400, not a database error)", async () => {
    const s = await setup();
    const { orderId } = await svc.createPurchase(s.ctx, s.project.id, material(s, { status: "ordered", lines: [{ lineageId: s.lineage("01"), amountCents: 1_000 }] }));
    await purchaseInvoicesService.setOrderMilestones(s.ctx, orderId, { milestones: [{ concept: "Todo", amountCents: 1_000 }] });
    const lines = [
      { lineageId: s.lineage("01"), amountCents: MAX_AMOUNT_CENTS },
      { lineageId: s.lineage("02"), amountCents: MAX_AMOUNT_CENTS },
    ];
    expect(await outcome(svc.updatePurchase(s.ctx, orderId, { lines, notes: "Ampliado" }))).toBe("invalid_input");
    const order = await svc.getPurchase(s.ctx, orderId);
    expect(order).toMatchObject({ amountCents: 1_000, notes: null, milestones: [{ concept: "Todo", amountCents: 1_000 }] });
    // Without a schedule the same order may be that large, as before.
    await purchaseInvoicesService.setOrderMilestones(s.ctx, orderId, { milestones: [] });
    await svc.updatePurchase(s.ctx, orderId, { lines });
    expect((await svc.getPurchase(s.ctx, orderId)).amountCents).toBe(2 * MAX_AMOUNT_CENTS);
  });
});
