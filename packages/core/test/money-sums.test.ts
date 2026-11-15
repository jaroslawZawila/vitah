import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { aiUsage, db } from "@repo/db";
import {
  budgetOverviewService,
  budgetService,
  deletedService,
  purchaseChecksService,
  purchaseDocumentsService,
  purchaseInvoicesService,
  purchaseSuppliersService,
  purchasingService,
  subcontractorsService,
  type Ctx,
} from "../src";
import { monthSpendCents } from "../src/ai-limit";
import { structuredCall } from "../src/budget-ai/claude";
import { loadObra, loadObraSummaries } from "../src/obra-data";
import { files } from "../src/testing";

// Money is integer cents in 32-bit columns: one amount stays under 2^31 (the
// services take up to 2.000.000.000), but what adds several of them up, or
// adds a row's VAT to its base, must not be computed (or cast) in 32 bits, and
// must come back from the driver as a number, never as the text of a bigint.

vi.mock("../src/storage", () => import("../src/testing"));
vi.mock("../src/budget-ai/claude", async (importActual) => ({
  ...(await importActual<typeof import("../src/budget-ai/claude")>()),
  structuredCall: vi.fn(),
}));
const claude = vi.mocked(structuredCall);

/** The largest single amount the services take. */
const BIG = 2_000_000_000;
/** Its VAT at 21 %. */
const VAT = 420_000_000;
const INT_MAX = 2 ** 31 - 1;

/** A number above what a 32-bit integer holds, exactly `expected`. */
function exactly(value: unknown, expected: number) {
  expect(typeof value).toBe("number");
  expect(value).toBe(expected);
  expect(expected).toBeGreaterThan(INT_MAX);
}

const pdf = (content: string) => new File([`%PDF-1.7 ${content}`], "doc.pdf", { type: "application/pdf" });

/**
 * A project with an accepted budget of two lines of 20 × 1.000.000 € (no
 * margins; chapter 20 holds 5 % of them), a material supplier and two placed
 * orders: A of 20.000.000 € on each line, B of 20.000.000 € on line 01.
 */
async function setup() {
  const tenant = await createTestTenant();
  const admin: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" };
  const project = await createTestProject(tenant.id, {
    startDate: new Date("2026-06-01T00:00:00Z"),
    completionDate: new Date("2027-03-31T00:00:00Z"),
  });
  const { revisionId } = await budgetService.createBudget(admin, project.id, { reference: "036/2026" });
  await budgetService.updateRevision(admin, project.id, revisionId, { overheadPct: 0, profitPct: 0 });
  const { revision } = await budgetService.getBudget(admin, project.id, revisionId);
  for (const code of ["01", "02"]) {
    await budgetService.addLine(admin, project.id, revision!.chapters.find((c) => c.code === code)!.id, {
      code: `${code}.01`,
      description: `Partida ${code}.01`,
      unit: "ud",
      quantity: 20,
      unitPriceCents: 100_000_000,
    });
  }
  await budgetService.acceptRevision(admin, project.id, revisionId, {}, { unissued: true });
  const { id: supplierId } = await subcontractorsService.createSubcontractor(admin, {
    kind: "company",
    legalName: "Piedra de Liébana S.L.",
    taxId: "B39654322",
    address: "Barrio La Serna 7",
    postalCode: "39570",
    city: "Potes",
    suppliesOnly: true,
  });
  const form = await purchasingService.getPurchaseForm(admin, project.id);
  const lineage = (code: string) => form.chapters.find((c) => c.code === code)!.lines[0]!.lineageId;
  const order = (description: string, codes: string[]) =>
    purchasingService.createPurchase(admin, project.id, {
      kind: "material",
      subcontractorId: supplierId,
      description,
      status: "ordered",
      orderedOn: "2026-06-01",
      lines: codes.map((code) => ({ lineageId: lineage(code), amountCents: BIG })),
    });
  const { orderId: orderA } = await order("Estructura", ["01", "02"]);
  const { orderId: orderB } = await order("Cubierta", ["01"]);
  return { tenant, admin, project, revisionId, supplierId, lineage, orderA, orderB };
}

type Setup = Awaited<ReturnType<typeof setup>>;

/** Two invoices of A, each of the largest base (VAT 21 % on top), due on 1 October: overdue. */
async function twoInvoices(s: Setup) {
  const invoice = (number: string) =>
    purchaseInvoicesService.createInvoice(s.admin, s.orderA, { number, issuedOn: "2026-09-01", baseCents: BIG });
  const { invoiceId: first } = await invoice("PL-1");
  const { invoiceId: second } = await invoice("PL-2");
  return { first, second };
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  claude.mockReset().mockResolvedValue({ findings: [] });
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

describe("money totals above 2^31 cents", () => {
  it("budget: a revision's PEC and its contingency line, from the lines' sums in SQL", async () => {
    const s = await setup();
    const { revisions, revision } = await budgetService.getBudget(s.admin, s.project.id);
    // 2 × 20.000.000 € + 5 % contingency.
    exactly(revisions[0]!.totalCents, 4_200_000_000);
    const contingency = revision!.chapters.find((c) => c.code === "20")!.lines[0]!;
    expect(contingency.unitPriceCents).toBe(200_000_000);
  });

  it("obra: the contract's total and what is built, summed in SQL as loadObra adds them up", async () => {
    const s = await setup();
    const { revision } = await budgetService.getBudget(s.admin, s.project.id);
    const line = revision!.chapters.find((c) => c.code === "01")!.lines[0]!;
    await budgetService.setProgress(s.admin, s.project.id, { lines: [{ id: line.id, executedPct: 50 }] });
    const lean = (await loadObraSummaries(s.tenant.id, [s.project.id])).get(s.project.id)!;
    exactly(lean.progress.totalCents, 4_200_000_000);
    expect(lean.progress.executedCents).toBe(1_000_000_000);
    expect(lean.progress).toEqual((await loadObra(s.tenant.id, s.project.id)).progress);
  });

  it("orders: what the list contracts, this year's, open and by supplier", async () => {
    const s = await setup();
    const listed = await purchasingService.listPurchases(s.admin, { by: "supplier" });
    exactly(listed.shownContractedCents, 6_000_000_000);
    exactly(listed.summary.yearContractedCents, 6_000_000_000);
    exactly(listed.summary.openCents, 6_000_000_000);
    expect(listed.summary.pendingCents).toBe(0);
    exactly(listed.bySupplier![0]!.contractedCents, 6_000_000_000);
    exactly(listed.bySupplier![0]!.openCents, 6_000_000_000);
  });

  it("orders: an order's whole amount in the facts its document's review is given", async () => {
    const s = await setup();
    await purchaseDocumentsService.addOrderDocument(s.admin, s.orderA, { title: "Pedido firmado", file: pdf("pedido") });
    await purchaseChecksService.queueNewChecks(s.admin);
    expect(await purchaseChecksService.runPendingChecks(s.admin)).toBe(1);
    const [options] = claude.mock.calls[0]!;
    expect(JSON.stringify(options.content[1])).toContain("importe actual 40000000.00 € sin IVA");
  });

  it("orders: what a line's invoices add up to, checked when the order's lines change", async () => {
    const s = await setup();
    for (const number of ["PL-1", "PL-2"]) {
      await purchaseInvoicesService.createInvoice(s.admin, s.orderB, { number, issuedOn: "2026-09-01", baseCents: BIG });
    }
    // 40.000.000 € invoiced on line 01 of B: it can't go below that (the database adds them up without overflowing).
    await expect(
      purchasingService.updatePurchase(s.admin, s.orderB, { lines: [{ lineageId: s.lineage("01"), amountCents: BIG - 1 }] }),
    ).rejects.toMatchObject({ code: "below_invoiced" });
  });

  it("invoices: what is owed and overdue, the rail's count, paid this month and an invoice's payments", async () => {
    const s = await setup();
    const { first, second } = await twoInvoices(s);
    // Each invoice alone, VAT in, is above 2^31.
    let listed = await purchaseInvoicesService.listInvoices(s.admin);
    exactly(listed.summary.outstandingCents, 2 * (BIG + VAT));
    exactly(listed.summary.overdueCents, 2 * (BIG + VAT));
    expect(listed.summary.outstandingInvoices).toBe(2);
    expect((await purchaseInvoicesService.getPurchasingCounts(s.admin)).dueAttention).toBe(2);

    await purchaseInvoicesService.createPayment(s.admin, first, { amountCents: BIG, paidOn: "2026-10-05" });
    await purchaseInvoicesService.createPayment(s.admin, first, { amountCents: VAT, paidOn: "2026-10-06" });
    await purchaseInvoicesService.createPayment(s.admin, second, { amountCents: BIG, paidOn: "2026-10-07" });

    const invoice = await purchaseInvoicesService.getInvoice(s.admin, first);
    exactly(invoice.paidCents, BIG + VAT);
    expect(invoice.state).toBe("paid");
    listed = await purchaseInvoicesService.listInvoices(s.admin);
    exactly(listed.summary.paidThisMonthCents, 2 * BIG + VAT);
    expect(listed.summary.outstandingCents).toBe(VAT);
    expect(listed.summary.paymentsThisMonth).toBe(3);
    const payments = await purchaseInvoicesService.listPayments(s.admin);
    exactly(payments.summary.monthCents, 2 * BIG + VAT);
    expect((await purchaseInvoicesService.getPurchasingCounts(s.admin)).dueAttention).toBe(1);
  });

  it("invoices: a deleted invoice's amount on Elementos eliminados", async () => {
    const s = await setup();
    const { invoiceId } = await purchaseInvoicesService.createInvoice(s.admin, s.orderB, { number: "PL-9", issuedOn: "2026-09-01", baseCents: BIG });
    await purchaseInvoicesService.deleteInvoice(s.admin, invoiceId);
    const { items } = await deletedService.listDeleted(s.admin);
    exactly(items.find((i) => i.id === invoiceId)!.amountCents, BIG + VAT);
  });

  it("suppliers: what a supplier was contracted, invoiced and owes", async () => {
    const s = await setup();
    await twoInvoices(s);
    const { suppliers, summary } = await purchaseSuppliersService.listSuppliers(s.admin);
    const supplier = suppliers.find((x) => x.id === s.supplierId)!;
    exactly(supplier.contractedCents, 6_000_000_000);
    exactly(supplier.invoicedCents, 2 * BIG);
    exactly(supplier.outstandingCents, 2 * (BIG + VAT));
    exactly(summary.contractedCents, 6_000_000_000);
    exactly(summary.overdueCents, 2 * (BIG + VAT));
  });

  it("project list: what an obra's overdue supplier invoices owe, and its built %", async () => {
    const s = await setup();
    await twoInvoices(s);
    const [row] = await budgetOverviewService.listProjectsWithBudget(s.admin, { signals: true });
    const overdue = row!.attention.find((a) => a.kind === "supplier_overdue")!;
    expect(overdue.count).toBe(2);
    exactly(overdue.amountCents, 2 * (BIG + VAT));
    expect(row!.progressPct).toBe(0);
  });

  it("AI spend: this month's cost comes back as a number", async () => {
    const s = await setup();
    const usage = { tenantId: s.tenant.id, purpose: "purchase.check", model: "m", inputTokens: 1, outputTokens: 1 };
    await db.insert(aiUsage).values([
      { ...usage, costMicroUsd: 30_000_000_000_000 },
      { ...usage, costMicroUsd: 30_000_000_000_000 },
    ]);
    exactly(await monthSpendCents(s.tenant.id), 6_000_000_000);
  });
});
