import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import {
  budgetService,
  constructionService,
  purchasingService as svc,
  subcontractorsService,
  type Ctx,
} from "../src";
import { files } from "../src/testing";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));

const pdf = (content = "%PDF-1.7 pedido") => new File([content], "Pedido.pdf", { type: "application/pdf" });

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
  await budgetService.acceptRevision(admin, project.id, revisionId);
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
    // 01: closed for 950 € (a saving of 50 €); 02: 400 € so far, more to order.
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
      deviationCents: 5_000,
      deviationBp: 500,
      toContractCents: 100_000,
      uncontractedLines: 1,
    });

    const { chapters, sources } = await constructionService.getCosts(s.ctx, s.project.id);
    expect(sources.purchasing).toBe("live");
    expect(chapters[0]!.lines[0]).toMatchObject({
      contractedCents: 95_000,
      contracting: "closed",
      deviationCents: 5_000,
      orders: [{ number: 1, supplierName: "Piedra de Liébana S.L.", lateDays: null }],
    });
    expect(chapters[1]!.lines[0]).toMatchObject({ contractedCents: 40_000, contracting: "open", deviationCents: null });
    expect(chapters[2]!.lines[0]).toMatchObject({ contractedCents: null, contracting: "none", orders: [] });

    const control = await constructionService.getControl(s.ctx, s.project.id);
    expect(control.chapters.map((c) => [c.code, c.contractedLines, c.openLines, c.contractedCents, c.deviationCents])).toEqual([
      ["01", 1, 0, 95_000, 5_000],
      ["02", 0, 1, 40_000, null],
      ["03", 0, 0, null, null],
    ]);
    expect(control.cost).toMatchObject({ contractedCents: 135_000, contractedCostCents: 100_000, deviationCents: 5_000, deviationBp: 500 });

    // Closing 02 with the rest: its deviation is over both orders.
    await svc.createPurchase(s.ctx, s.project.id, material(s, {
      status: "ordered",
      lines: [{ lineageId: s.lineage("02"), amountCents: 65_000 }],
    }));
    const detail = await svc.getPurchase(s.ctx, open.orderId);
    expect(detail.lines[0]).toMatchObject({ code: "02.01", costCents: 100_000, amountCents: 40_000, otherCents: 65_000, deviationCents: -5_000 });
    expect((await constructionService.getCosts(s.ctx, s.project.id)).chapters[1]!.lines[0]).toMatchObject({
      contracting: "closed",
      contractedCents: 105_000,
      deviationBp: -500,
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
    // Placing and delivering on the days they happened; the steps between on the day recorded.
    expect(order.reached).toEqual({
      pending: "2026-10-17",
      ordered: "2026-10-03",
      confirmed: "2026-10-17",
      in_transit: "2026-10-17",
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

describe("the order's file", () => {
  it("stores, replaces, downloads and removes the order's PDF", async () => {
    const s = await setup();
    const { orderId } = await svc.createPurchase(s.ctx, s.project.id, material(s));
    await svc.uploadPurchaseFile(s.ctx, orderId, { file: pdf("%PDF-1.7 v1") });
    await svc.uploadPurchaseFile(s.ctx, orderId, { file: pdf("%PDF-1.7 v2") });
    expect(files.size).toBe(1);

    const order = await svc.getPurchase(s.ctx, orderId);
    expect(order).toMatchObject({ hasFile: true, file: { name: "Pedido.pdf" } });
    const stored = await svc.openPurchaseFile(s.ctx, orderId);
    expect(await new Response(stored.body).text()).toBe("%PDF-1.7 v2");

    await svc.deletePurchaseFile(s.ctx, orderId);
    expect(files.size).toBe(0);
    await expect(svc.openPurchaseFile(s.ctx, orderId)).rejects.toMatchObject({ code: "not_found" });
    await expect(
      svc.uploadPurchaseFile(s.ctx, orderId, { file: new File(["hola"], "pedido.pdf") }),
    ).rejects.toMatchObject({ code: "invalid_file_type" });
  });
});

describe("listPurchases", () => {
  it("lists every project's orders with the year's totals, and one supplier's", async () => {
    const s = await setup();
    const other = await createTestProject(s.tenant.id);
    const { revisionId } = await framerDraft(s.admin, other.id, ["01"]);
    await budgetService.acceptRevision(s.admin, other.id, revisionId);
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
    });
    expect(all.projects.map((p) => p.ref).sort()).toEqual([s.project.ref, other.ref].sort());
    expect((await svc.listSupplierOrders(s.ctx, s.subcontractorId)).map((o) => o.projectRef)).toEqual([other.ref]);
    await expect(svc.listSupplierOrders(s.ctx, "nope")).rejects.toMatchObject({ code: "not_found" });
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
});

describe("access", () => {
  it("lets viewers read but not write", async () => {
    const s = await setup("viewer");
    const { orderId } = await svc.createPurchase(s.admin, s.project.id, material(s));
    expect((await svc.getPurchase(s.ctx, orderId)).id).toBe(orderId);
    await expect(svc.createPurchase(s.ctx, s.project.id, material(s))).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.setPurchaseStatus(s.ctx, orderId, { status: "ordered" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.updatePurchase(s.ctx, orderId, { notes: "x" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.uploadPurchaseFile(s.ctx, orderId, { file: pdf() })).rejects.toMatchObject({ code: "forbidden" });
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
    expect((await svc.getPurchase(s.ctx, orderId)).lines[0]).toMatchObject({ deviationCents: 5_000 });
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
