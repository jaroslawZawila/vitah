import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { and, db, eq, idempotencyKeys, isNull, purchaseInvoices, purchasePayments, subcontractorAssignments } from "@repo/db";
import {
  budgetService,
  deletedService,
  projectsService,
  purchaseInvoicesService as invoices,
  purchasingService,
  subcontractorWorkersService as workers,
  subcontractorsService,
  type Ctx,
} from "../src";
import { files } from "../src/testing";
import { framerDraft } from "./budget-fixture";

// Where three changes meet: what a user deletes can be restored (./deleted),
// a create sent twice with a key is applied once (./idempotency), and the long
// lists are counted and added up in the database, a page at a time (./paging).
// Each has its own tests; these are for the three together.

vi.mock("../src/storage", () => import("../src/testing"));
vi.mock("../src/push", () => ({ sendPush: vi.fn(async () => []) }));

const pdf = (text = "%PDF-1.7 contenido") => new File([text], "documento.pdf", { type: "application/pdf" });
const newKey = () => crypto.randomUUID();

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
 * An obra with an accepted budget of chapters 01–03 (1.000 € at cost each), a
 * subcontract of line 03 (980 €, 5 % retention) and an order of material for
 * lines 01 and 02 (950 € + 500 €), both placed.
 */
async function setup() {
  const tenant = await createTestTenant();
  const admin: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin", name: "Ana Admin" })).id, role: "admin" };
  const manager: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "manager", name: "Laura Pérez" })).id, role: "manager" };
  const project = await createTestProject(tenant.id, {
    ref: "VTH-26-001",
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
  const form = await purchasingService.getPurchaseForm(admin, project.id);
  const lineage = (code: string) => form.chapters.find((c) => c.code === code)!.lines[0]!.lineageId;
  const sub = await purchasingService.createPurchase(admin, project.id, {
    kind: "subcontract",
    subcontractorId,
    description: "Estructura Steel Frame",
    status: "contracted",
    orderedOn: "2026-06-18",
    retentionBp: 500,
    lines: [{ lineageId: lineage("03"), amountCents: 98_000 }],
  });
  const material = await purchasingService.createPurchase(admin, project.id, {
    kind: "material",
    subcontractorId: supplierId,
    description: "Hormigón y lámina",
    status: "ordered",
    orderedOn: "2026-06-01",
    lines: [
      { lineageId: lineage("01"), amountCents: 95_000 },
      { lineageId: lineage("02"), amountCents: 50_000 },
    ],
  });
  return { tenant, admin, manager, project, subcontractorId, supplierId, subId: sub.orderId, materialId: material.orderId };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** The subcontract's invoice: 490 € of its 980 €, 465,50 € to pay now and 24,50 € retained. */
const invoice = (overrides: Record<string, unknown> = {}) => ({ number: "MSN-2026/112", issuedOn: "2026-09-22", baseCents: 49_000, ...overrides });

const livePayments = (invoiceId: string) =>
  db
    .select({ id: purchasePayments.id })
    .from(purchasePayments)
    .where(and(eq(purchasePayments.invoiceId, invoiceId), isNull(purchasePayments.deletedAt)));

const keys = (s: Setup) => db.select().from(idempotencyKeys).where(eq(idempotencyKeys.tenantId, s.tenant.id));

const deletedIds = async (s: Setup) => (await deletedService.listDeleted(s.admin)).items.map((i) => i.id);

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("a payment recorded with an idempotency key, deleted and restored", () => {
  it("is one payment throughout: the key neither pays again nor stands in the restore's way", async () => {
    const s = await setup();
    const { invoiceId } = await invoices.createInvoice(s.manager, s.subId, invoice());
    const idempotencyKey = newKey();
    const input = () => ({ amountCents: 20_000, paidOn: "2026-10-15", reference: "TRF-1", file: pdf(), idempotencyKey });
    const first = await invoices.createPayment(s.manager, invoiceId, input());

    await invoices.deletePayment(s.manager, first.paymentId);
    // The form sent again (a retry that arrives late): the answer of the first call, and nothing paid.
    expect(await invoices.createPayment(s.manager, invoiceId, input())).toEqual(first);
    expect(await livePayments(invoiceId)).toEqual([]);
    expect(await invoices.getInvoice(s.admin, invoiceId)).toMatchObject({ paidCents: 0, outstandingCents: 46_550, payments: [] });
    expect(await deletedIds(s)).toEqual([first.paymentId]);

    expect(await deletedService.restoreDeleted(s.admin, "payment", first.paymentId)).toMatchObject({ id: first.paymentId });

    // Sent once more after the restore: still that payment, counted once.
    expect(await invoices.createPayment(s.manager, invoiceId, input())).toEqual(first);
    expect(await livePayments(invoiceId)).toEqual([{ id: first.paymentId }]);
    expect(await db.select().from(purchasePayments)).toHaveLength(1);
    expect(await invoices.getInvoice(s.admin, invoiceId)).toMatchObject({ paidCents: 20_000, outstandingCents: 26_550, state: "partial" });
    const paid = await invoices.listPayments(s.admin, {}, { page: 1, limit: 10 });
    expect(paid.paging.total).toBe(1);
    expect(paid.summary).toEqual({ monthCents: 20_000, monthPayments: 1 });
    expect(files.size).toBe(1);
    expect(await keys(s)).toHaveLength(1);
    expect(await deletedIds(s)).toEqual([]);
  });

  it("is refused back once the invoice was paid again under another key: never both", async () => {
    const s = await setup();
    const { invoiceId } = await invoices.createInvoice(s.manager, s.subId, invoice());
    const idempotencyKey = newKey();
    const input = () => ({ amountCents: 30_000, paidOn: "2026-10-15", idempotencyKey });
    const first = await invoices.createPayment(s.manager, invoiceId, input());
    await invoices.deletePayment(s.manager, first.paymentId);
    // Paid again from a new form (a new key), in full and its retention released: 490 €.
    const again = await invoices.createPayment(s.manager, invoiceId, { amountCents: 49_000, paidOn: "2026-10-16", idempotencyKey: newKey() });

    await expect(deletedService.restoreDeleted(s.admin, "payment", first.paymentId)).rejects.toMatchObject({ code: "exceeds_amount", status: 409 });
    // The first key still answers its own (deleted) payment, and pays nothing.
    expect(await invoices.createPayment(s.manager, invoiceId, input())).toEqual(first);

    expect(await livePayments(invoiceId)).toEqual([{ id: again.paymentId }]);
    expect(await invoices.getInvoice(s.admin, invoiceId)).toMatchObject({ paidCents: 49_000, payableLeftCents: 0 });
    expect((await invoices.listPayments(s.admin, {}, { page: 1 })).summary).toEqual({ monthCents: 49_000, monthPayments: 1 });
  });

  it("holds a new payment to what the restored one left, the same rule both ways", async () => {
    const s = await setup();
    const { invoiceId } = await invoices.createInvoice(s.manager, s.subId, invoice());
    const { paymentId } = await invoices.createPayment(s.manager, invoiceId, { amountCents: 30_000, paidOn: "2026-10-15", idempotencyKey: newKey() });
    await invoices.deletePayment(s.manager, paymentId);
    await deletedService.restoreDeleted(s.admin, "payment", paymentId);
    const idempotencyKey = newKey();

    // 190 € are left of the 490 €: 190,01 € don't fit, and the refusal keeps no key.
    await expect(invoices.createPayment(s.manager, invoiceId, { amountCents: 19_001, idempotencyKey })).rejects.toMatchObject({ code: "exceeds_amount" });
    await expect(invoices.createPayment(s.manager, invoiceId, { amountCents: 19_000, idempotencyKey })).resolves.toMatchObject({ paymentId: expect.any(String) });
    expect(await invoices.getInvoice(s.admin, invoiceId)).toMatchObject({ paidCents: 49_000, payableLeftCents: 0, state: "paid" });
  });
});

describe("an invoice registered with an idempotency key, deleted and restored", () => {
  it("is one invoice throughout, with its one PDF", async () => {
    const s = await setup();
    const idempotencyKey = newKey();
    const input = () => ({ ...invoice(), file: pdf("%PDF-1.7 factura"), idempotencyKey });
    const first = await invoices.createInvoice(s.manager, s.subId, input());

    await invoices.deleteInvoice(s.manager, first.invoiceId);
    expect(await invoices.createInvoice(s.manager, s.subId, input())).toEqual(first);
    expect((await invoices.listInvoices(s.admin, {}, { page: 1 })).paging.total).toBe(0);
    expect((await purchasingService.getPurchase(s.admin, s.subId)).invoicedCents).toBe(0);

    await deletedService.restoreDeleted(s.admin, "invoice", first.invoiceId);

    expect(await invoices.createInvoice(s.manager, s.subId, input())).toEqual(first);
    expect(await db.select().from(purchaseInvoices)).toHaveLength(1);
    expect(files.size).toBe(1);
    expect((await purchasingService.getPurchase(s.admin, s.subId)).invoicedCents).toBe(49_000);
    const listed = await invoices.listInvoices(s.admin, {}, { page: 1 });
    expect(listed.invoices.map((i) => i.id)).toEqual([first.invoiceId]);
    expect(listed.paging.total).toBe(1);
    expect(listed.summary).toMatchObject({ outstandingCents: 46_550, outstandingInvoices: 1 });
    // Its number is taken again, for any other key.
    await expect(invoices.createInvoice(s.manager, s.subId, { ...invoice(), idempotencyKey: newKey() })).rejects.toMatchObject({ code: "duplicate_number" });
  });

  it("stays deleted once its number was registered again under another key, whatever its own key answers", async () => {
    const s = await setup();
    const idempotencyKey = newKey();
    const first = await invoices.createInvoice(s.manager, s.subId, { ...invoice(), idempotencyKey });
    await invoices.deleteInvoice(s.manager, first.invoiceId);
    const second = await invoices.createInvoice(s.manager, s.subId, { ...invoice(), idempotencyKey: newKey() });
    expect(second.invoiceId).not.toBe(first.invoiceId);

    await expect(deletedService.restoreDeleted(s.admin, "invoice", first.invoiceId)).rejects.toMatchObject({ code: "duplicate_number", status: 409 });
    expect(await invoices.createInvoice(s.manager, s.subId, { ...invoice(), idempotencyKey })).toEqual(first);

    const listed = await invoices.listInvoices(s.admin, {}, { page: 1 });
    expect(listed.invoices.map((i) => i.id)).toEqual([second.invoiceId]);
    expect(listed.groupCounts).toMatchObject({ all: 1, open: 1 });
    expect((await purchasingService.getPurchase(s.admin, s.subId)).invoicedCents).toBe(49_000);
  });
});

describe("the paged lists' totals, after a delete and after a restore", () => {
  /** Two invoices (the subcontract's, part paid, and the material's, paid in full) and their three payments. */
  async function invoiced() {
    const s = await setup();
    const { invoiceId } = await invoices.createInvoice(s.manager, s.subId, invoice());
    const material = await invoices.createInvoice(s.manager, s.materialId, invoice({ number: "PL-77", issuedOn: "2026-09-01", baseCents: 60_000 }));
    const total = (await invoices.getInvoice(s.admin, material.invoiceId)).payableLeftCents;
    const part = await invoices.createPayment(s.manager, invoiceId, { amountCents: 6_550, paidOn: "2026-10-10" });
    const rest = await invoices.createPayment(s.manager, material.invoiceId, { amountCents: total - 10_000, paidOn: "2026-10-12" });
    const last = await invoices.createPayment(s.manager, material.invoiceId, { amountCents: 10_000, paidOn: "2026-10-15" });
    return { ...s, invoiceId, materialInvoiceId: material.invoiceId, materialTotal: total, payments: [part.paymentId, rest.paymentId, last.paymentId] };
  }

  /** Every page of one row, and what the lists count and add up beside them. */
  async function lists(s: Setup) {
    const page = (n: number) => invoices.listInvoices(s.admin, {}, { page: n, limit: 1 });
    const [first, second, third, whole, open, paid, payments, orders, counts] = await Promise.all([
      page(1),
      page(2),
      page(3),
      invoices.listInvoices(s.admin),
      invoices.listInvoices(s.admin, {}, { page: 1, group: "open" }),
      invoices.listInvoices(s.admin, {}, { page: 1, group: "paid" }),
      invoices.listPayments(s.admin, {}, { page: 1, limit: 2 }),
      purchasingService.listPurchases(s.admin, { page: 1, limit: 1 }),
      invoices.getPurchasingCounts(s.admin),
    ]);
    return {
      invoicePages: [first, second, third].map((p) => p.invoices.map((i) => i.id)),
      invoicePaging: first.paging,
      groupCounts: first.groupCounts,
      summary: first.summary,
      // The whole list (no page asked for) counts what the pages count.
      wholeIds: whole.invoices.map((i) => i.id),
      wholePaging: whole.paging,
      open: { ids: open.invoices.map((i) => i.id), total: open.paging.total },
      paid: { ids: paid.invoices.map((i) => i.id), total: paid.paging.total },
      paymentIds: payments.payments.map((p) => p.id),
      paymentPaging: payments.paging,
      paymentSummary: payments.summary,
      orderPaging: orders.paging,
      orderCounts: orders.groupCounts,
      counts,
    };
  }

  it("count and add up an invoice out while it is deleted, and exactly as before once it is back", async () => {
    const s = await invoiced();
    // A third invoice, nothing paid of it yet (one with payments can't be deleted): 200 € + 21 % VAT, due in November.
    const extra = await invoices.createInvoice(s.manager, s.materialId, invoice({ number: "PL-78", issuedOn: "2026-10-05", baseCents: 20_000 }));
    const owes = (await invoices.getInvoice(s.admin, extra.invoiceId)).outstandingCents;
    const before = await lists(s);
    expect(before.invoicePaging).toEqual({ page: 1, limit: 1, total: 3, pages: 3 });
    // Owed first, soonest due first; then the paid one.
    expect(before.invoicePages).toEqual([[s.invoiceId], [extra.invoiceId], [s.materialInvoiceId]]);
    expect(before.groupCounts).toEqual({ all: 3, open: 2, overdue: 0, paid: 1, credit: 0 });
    expect(before.summary).toMatchObject({
      outstandingCents: 40_000 + owes,
      outstandingInvoices: 2,
      outstandingSuppliers: 2,
      paidThisMonthCents: 6_550 + s.materialTotal,
      paymentsThisMonth: 3,
    });
    expect(before.paymentPaging).toEqual({ page: 1, limit: 2, total: 3, pages: 2 });

    await invoices.deleteInvoice(s.manager, extra.invoiceId);

    const without = await lists(s);
    expect(without.invoicePaging).toEqual({ page: 1, limit: 1, total: 2, pages: 2 });
    expect(without.invoicePages).toEqual([[s.invoiceId], [s.materialInvoiceId], []]);
    expect(without.wholeIds).toEqual([s.invoiceId, s.materialInvoiceId]);
    expect(without.wholePaging.total).toBe(2);
    expect(without.groupCounts).toEqual({ all: 2, open: 1, overdue: 0, paid: 1, credit: 0 });
    expect(without.open).toEqual({ ids: [s.invoiceId], total: 1 });
    expect(without.summary).toMatchObject({ outstandingCents: 40_000, outstandingInvoices: 1, outstandingSuppliers: 1 });
    // Its order and the payments of the others are untouched.
    expect(without.orderPaging).toEqual(before.orderPaging);
    expect(without.paymentPaging).toEqual(before.paymentPaging);
    expect(without.paymentSummary).toEqual(before.paymentSummary);

    await deletedService.restoreDeleted(s.admin, "invoice", extra.invoiceId);

    expect(await lists(s)).toEqual(before);
  });

  it("move an invoice between the groups with its payment: deleted it owes again, restored it is paid", async () => {
    const s = await invoiced();
    const before = await lists(s);
    const [, , last] = s.payments;

    await invoices.deletePayment(s.manager, last!);

    const without = await lists(s);
    expect(without.groupCounts).toEqual({ all: 2, open: 2, overdue: 1, paid: 0, credit: 0 });
    expect(without.invoicePaging.total).toBe(2);
    expect(without.open.total).toBe(2);
    expect(without.paid).toEqual({ ids: [], total: 0 });
    expect(without.summary).toMatchObject({
      outstandingCents: 50_000,
      outstandingInvoices: 2,
      overdueCents: 10_000,
      overdueInvoices: 1,
      paidThisMonthCents: before.summary.paidThisMonthCents - 10_000,
      paymentsThisMonth: 2,
    });
    expect(without.paymentPaging).toEqual({ page: 1, limit: 2, total: 2, pages: 1 });
    expect(without.paymentIds).not.toContain(last);
    expect(without.paymentSummary).toEqual({ monthCents: before.paymentSummary.monthCents - 10_000, monthPayments: 2 });

    await deletedService.restoreDeleted(s.admin, "payment", last!);

    const after = await lists(s);
    expect(after).toEqual(before);
    expect(after.paid).toEqual({ ids: [s.materialInvoiceId], total: 1 });
    expect(after.paymentPaging).toEqual({ page: 1, limit: 2, total: 3, pages: 2 });
  });

  it("leave a deleted obra's orders, invoices and payments out of every page and total, and bring them back with it", async () => {
    const s = await invoiced();
    const before = await lists(s);
    expect(before.orderPaging).toEqual({ page: 1, limit: 1, total: 2, pages: 2 });

    await projectsService.deleteProject(s.admin, s.project.id);

    const without = await lists(s);
    expect(without.orderPaging).toEqual({ page: 1, limit: 1, total: 0, pages: 1 });
    expect(without.orderCounts).toEqual({ all: 0, open: 0, pending: 0, done: 0, cancelled: 0 });
    expect(without.invoicePaging.total).toBe(0);
    expect(without.groupCounts).toEqual({ all: 0, open: 0, overdue: 0, paid: 0, credit: 0 });
    expect(without.summary).toMatchObject({ outstandingCents: 0, outstandingInvoices: 0, paidThisMonthCents: 0, paymentsThisMonth: 0 });
    expect(without.paymentPaging.total).toBe(0);
    expect(without.paymentSummary).toEqual({ monthCents: 0, monthPayments: 0 });

    await deletedService.restoreDeleted(s.admin, "project", s.project.id);

    expect(await lists(s)).toEqual(before);
  });

  it("list an obra's workers by its companies' live assignments: gone with one taken off, back with it restored", async () => {
    const s = await setup();
    const { id: workerId } = await workers.createWorker(s.admin, {
      subcontractorId: s.subcontractorId,
      firstName: "Iván",
      surnames: "Gómez Ruiz",
      idDocument: "72145836B",
      trade: "electrical",
      category: "officer_1",
    });
    await subcontractorsService.assignToProject(s.admin, s.subcontractorId, s.project.id, { chapterCodes: ["03"] });
    const onObra = () => workers.listWorkersPage(s.admin, { page: 1, limit: 10, projectId: s.project.id });
    const before = await onObra();
    expect(before.workers.map((w) => w.id)).toEqual([workerId]);
    expect(before.paging).toEqual({ page: 1, limit: 10, total: 1, pages: 1 });

    await subcontractorsService.removeAssignment(s.manager, s.subcontractorId, s.project.id);

    const without = await onObra();
    expect(without.workers).toEqual([]);
    expect(without.paging).toEqual({ page: 1, limit: 10, total: 0, pages: 1 });
    expect(without.counts.all).toBe(0);
    expect(without.summary.registered).toBe(0);
    // Still a worker of the company, off this obra only.
    expect((await workers.listWorkersPage(s.admin, { page: 1 })).paging.total).toBe(1);

    const [assignment] = await db.select({ id: subcontractorAssignments.id }).from(subcontractorAssignments);
    await deletedService.restoreDeleted(s.admin, "assignment", assignment!.id);

    expect(await onObra()).toEqual(before);
  });
});
