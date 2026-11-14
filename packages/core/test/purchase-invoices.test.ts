import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { db, eq, projects, purchaseInvoiceFiles, purchaseInvoices, purchaseOrders, purchasePayments, sql } from "@repo/db";
import {
  budgetService,
  constructionService,
  isValidCif,
  projectsService,
  purchaseInvoicesService as svc,
  purchaseSuppliersService,
  purchasingService,
  subcontractorsService,
  type Ctx,
} from "../src";
import { DUE_SOON_DAYS, orderLabel, PAYMENT_FORECAST_DAYS, PURCHASE_INVOICE_GROUPS } from "../src/contract";
import { lateDays } from "../src/control-calc";
import { addDays } from "../src/obra-calc";
import { isDueSoon, isOwed } from "../src/purchase-calc";
import { files } from "../src/testing";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));

const pdf = (content = "%PDF-1.7 factura", name = "Factura.pdf") => new File([content], name, { type: "application/pdf" });

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
 * A project with an accepted budget of chapters 01–03 (one line of 1.000 € at
 * cost each); a subcontract of line 03 (980 €, 5 % retention) and an order of
 * material for lines 01 and 02 (950 € + 500 €), both placed.
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
  return { tenant, admin, ctx, project, subcontractorId, supplierId, lineage, subId: sub.orderId, materialId: material.orderId };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const invoice = (overrides: Record<string, unknown> = {}) => ({
  number: "MSN-2026/112",
  issuedOn: "2026-09-22",
  baseCents: 49_000,
  ...overrides,
});

/** The subcontract with two milestones (half and half). */
async function withMilestones(s: Setup) {
  await svc.setOrderMilestones(s.ctx, s.subId, {
    milestones: [
      { concept: "Inicio de fabricación", amountCents: 49_000 },
      { concept: "Fin de montaje", amountCents: 49_000 },
    ],
  });
  const { milestones } = await purchasingService.getPurchase(s.ctx, s.subId);
  return milestones;
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

describe("createInvoice", () => {
  it("takes its terms from the order: due in 30 days, reverse-charged, the order's retention", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice());
    expect(await svc.getInvoice(s.ctx, invoiceId)).toMatchObject({
      kind: "invoice",
      number: "MSN-2026/112",
      dueOn: "2026-10-22",
      vatKind: "reverse_charge",
      vatCents: 0,
      retentionBp: 500,
      retentionCents: 2_450,
      totalCents: 49_000,
      payableCents: 46_550,
      outstandingCents: 46_550,
      state: "pending",
      supplierName: "Montajes Steel Norte S.L.",
      projectRef: expect.any(String),
      createdBy: "Laura Pérez",
      lines: [{ lineageId: s.lineage("03"), chapterCode: "03", amountCents: 49_000 }],
    });
  });

  it("charges a material supplier's VAT and splits the base across the order's lines in proportion", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.materialId, invoice({ number: "SOC-0912", baseCents: 14_500, dueOn: "2026-10-15" }));
    const detail = await svc.getInvoice(s.ctx, invoiceId);
    expect(detail).toMatchObject({ vatKind: "vat21", vatCents: 3_045, totalCents: 17_545, dueOn: "2026-10-15", state: "overdue", overdueDays: 4 });
    expect(detail.lines.map((l) => [l.chapterCode, l.amountCents])).toEqual([
      ["01", 9_500],
      ["02", 5_000],
    ]);
  });

  it("takes the split given, when it adds up to the base", async () => {
    const s = await setup();
    const lines = [{ lineageId: s.lineage("02"), amountCents: 14_500 }];
    const { invoiceId } = await svc.createInvoice(s.ctx, s.materialId, invoice({ number: "SOC-1", baseCents: 14_500, lines }));
    expect((await svc.getInvoice(s.ctx, invoiceId)).lines).toMatchObject([{ chapterCode: "02", amountCents: 14_500 }]);

    const reject = (overrides: Record<string, unknown>) => svc.createInvoice(s.ctx, s.materialId, invoice({ number: "SOC-2", ...overrides }));
    await expect(reject({ baseCents: 14_500, lines: [{ lineageId: s.lineage("02"), amountCents: 14_000 }] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(reject({ lines: [{ lineageId: s.lineage("03"), amountCents: 49_000 }] })).rejects.toMatchObject({ code: "unknown_line" });
  });

  it("keeps each supplier's numbers unique, and checks dates, amounts and the order", async () => {
    const s = await setup();
    await svc.createInvoice(s.ctx, s.subId, invoice());
    await expect(svc.createInvoice(s.ctx, s.subId, invoice())).rejects.toMatchObject({ code: "duplicate_number" });
    // Another supplier may use the same number.
    await svc.createInvoice(s.ctx, s.materialId, invoice());

    const reject = (overrides: Record<string, unknown>) => svc.createInvoice(s.ctx, s.subId, invoice({ number: "X", ...overrides }));
    await expect(reject({ issuedOn: "2026-10-20" })).rejects.toMatchObject({ code: "invalid_date" });
    await expect(reject({ dueOn: "2026-09-01" })).rejects.toMatchObject({ code: "invalid_date" });
    await expect(reject({ baseCents: 0 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(reject({ baseCents: -100 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(reject({ number: " " })).rejects.toMatchObject({ code: "missing_fields" });
    await expect(reject({ vatKind: "vat4" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(reject({ retentionBp: 5000 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(reject({ file: new File(["hello"], "x.pdf") })).rejects.toMatchObject({ code: "invalid_file_type" });

    const pending = await purchasingService.createPurchase(s.admin, s.project.id, {
      kind: "subcontract",
      subcontractorId: s.subcontractorId,
      description: "Pintura",
      lines: [{ lineageId: s.lineage("03"), amountCents: 1_000 }],
    });
    await expect(svc.createInvoice(s.ctx, pending.orderId, invoice({ number: "Y" }))).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("assigns an invoice to one of the order's milestones when it has a schedule", async () => {
    const s = await setup();
    const [first] = await withMilestones(s);
    await expect(svc.createInvoice(s.ctx, s.subId, invoice())).rejects.toMatchObject({ code: "missing_fields" });
    await expect(svc.createInvoice(s.ctx, s.subId, invoice({ milestoneId: "nope" }))).rejects.toMatchObject({ code: "invalid_input" });
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice({ milestoneId: first!.id }));
    expect(await svc.getInvoice(s.ctx, invoiceId)).toMatchObject({ milestoneId: first!.id, milestoneConcept: "Inicio de fabricación" });
  });

  it("stores the PDF as its first version", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice({ file: pdf("%PDF-1.7 v1", "MSN-112.pdf") }));
    const detail = await svc.getInvoice(s.ctx, invoiceId);
    expect(detail.hasFile).toBe(true);
    expect(detail.files).toMatchObject([{ version: 1, filename: "MSN-112.pdf", note: null, by: "Laura Pérez" }]);
    const file = await svc.openInvoiceFile(s.ctx, invoiceId);
    expect(file).toMatchObject({ filename: "MSN-112.pdf", contentType: "application/pdf" });
  });
});

describe("credit notes", () => {
  it("rectify an invoice of the same order, taking off what is owed", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice());
    const { invoiceId: creditId } = await svc.createInvoice(s.ctx, s.subId, {
      kind: "credit_note",
      number: "MSN-R07",
      issuedOn: "2026-10-01",
      rectifiesId: invoiceId,
      baseCents: -10_000,
      retentionBp: 0,
    });
    const credit = await svc.getInvoice(s.ctx, creditId);
    expect(credit).toMatchObject({
      kind: "credit_note",
      state: "credit",
      dueOn: null,
      rectifiesNumber: "MSN-2026/112",
      payableCents: -10_000,
      lines: [{ chapterCode: "03", amountCents: -10_000 }],
    });
    const original = await svc.getInvoice(s.ctx, invoiceId);
    expect(original).toMatchObject({ outstandingCents: 36_550, creditNotes: [{ id: creditId }] });
  });

  it("never take off more than the invoice leaves, nor rectify another order's or a credit note", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice());
    const credit = (overrides: Record<string, unknown>) =>
      svc.createInvoice(s.ctx, s.subId, { kind: "credit_note", number: "R", issuedOn: "2026-10-01", rectifiesId: invoiceId, baseCents: -1_000, ...overrides });
    await credit({ number: "R1", baseCents: -40_000 });
    await expect(credit({ number: "R2", baseCents: -9_001 })).rejects.toMatchObject({ code: "exceeds_amount" });
    await expect(credit({ baseCents: 1_000 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(credit({ rectifiesId: undefined })).rejects.toMatchObject({ code: "missing_fields" });

    const other = await svc.createInvoice(s.ctx, s.materialId, invoice({ number: "SOC-1", baseCents: 1_000 }));
    await expect(credit({ rectifiesId: other.invoiceId })).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("createPayment", () => {
  it("adds up partial payments until it is paid, then releases the retention", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice());
    await svc.createPayment(s.ctx, invoiceId, { amountCents: 20_000, paidOn: "2026-10-15", reference: "TR-1" });
    expect(await svc.getInvoice(s.ctx, invoiceId)).toMatchObject({
      state: "partial",
      paidCents: 20_000,
      outstandingCents: 26_550,
      retainedCents: 2_450,
      payableLeftCents: 29_000,
      payments: [{ amountCents: 20_000, paidOn: "2026-10-15", method: "transfer", reference: "TR-1", by: "Laura Pérez" }],
    });

    await svc.createPayment(s.ctx, invoiceId, { amountCents: 26_550, method: "confirming" });
    expect(await svc.getInvoice(s.ctx, invoiceId)).toMatchObject({ state: "paid", outstandingCents: 0, retainedCents: 2_450, payableLeftCents: 2_450 });

    await expect(svc.createPayment(s.ctx, invoiceId, { amountCents: 2_451 })).rejects.toMatchObject({ code: "exceeds_amount" });
    await svc.createPayment(s.ctx, invoiceId, { amountCents: 2_450 });
    expect(await svc.getInvoice(s.ctx, invoiceId)).toMatchObject({ retainedCents: 0, payableLeftCents: 0 });
  });

  it("checks the date, the amount and what it pays", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice());
    const pay = (overrides: Record<string, unknown>) => svc.createPayment(s.ctx, invoiceId, { amountCents: 100, ...overrides });
    await expect(pay({ paidOn: "2026-09-21" })).rejects.toMatchObject({ code: "invalid_date" });
    await expect(pay({ paidOn: "2026-10-20" })).rejects.toMatchObject({ code: "invalid_date" });
    await expect(pay({ amountCents: 0 })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(pay({ method: "cash" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(pay({ amountCents: 49_001 })).rejects.toMatchObject({ code: "exceeds_amount" });

    const credit = await svc.createInvoice(s.ctx, s.subId, { kind: "credit_note", number: "R", issuedOn: "2026-10-01", rectifiesId: invoiceId, baseCents: -1_000 });
    await expect(svc.createPayment(s.ctx, credit.invoiceId, { amountCents: 100 })).rejects.toMatchObject({ code: "invalid_state" });
  });

  it("keeps the proof, and a payment recorded by mistake can go: its row and its proof stay, out of every read", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice());
    const { paymentId } = await svc.createPayment(s.ctx, invoiceId, { amountCents: 1_000, file: pdf("%PDF-1.7 justificante", "Justificante.pdf") });
    expect(await svc.openPaymentFile(s.ctx, paymentId)).toMatchObject({ filename: "Justificante.pdf" });
    const stored = files.size;

    await svc.deletePayment(s.ctx, paymentId);
    // A soft delete: the row says who and when, and nothing leaves the storage.
    const [row] = await db.select().from(purchasePayments).where(eq(purchasePayments.id, paymentId));
    expect(row).toMatchObject({ amountCents: 1_000, deletedAt: expect.any(Date), deletedById: s.ctx.userId });
    expect(files.size).toBe(stored);
    expect(files.has(row!.filePathname!)).toBe(true);

    expect(await svc.getInvoice(s.ctx, invoiceId)).toMatchObject({ paidCents: 0, state: "pending", payments: [] });
    expect((await svc.listPayments(s.ctx)).payments).toEqual([]);
    expect((await svc.getPurchasingCounts(s.ctx)).payments).toBe(0);
    await expect(svc.openPaymentFile(s.ctx, paymentId)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.deletePayment(s.ctx, paymentId)).rejects.toMatchObject({ code: "not_found" });
    expect((await svc.getInvoice(s.ctx, invoiceId)).events.map((e) => e.action)).toEqual(["payment_deleted", "payment_added", "invoice_created"]);
  });
});

describe("updateInvoice and deleteInvoice", () => {
  it("changes its number and dates any time, its amounts only until something is paid", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.materialId, invoice({ number: "SOC-1", baseCents: 14_500 }));
    await svc.updateInvoice(s.ctx, invoiceId, { baseCents: 29_000 });
    const detail = await svc.getInvoice(s.ctx, invoiceId);
    // The split keeps its proportions.
    expect(detail.lines.map((l) => l.amountCents)).toEqual([19_000, 10_000]);
    expect(detail).toMatchObject({ vatCents: 6_090 });

    await svc.createPayment(s.ctx, invoiceId, { amountCents: 100 });
    await expect(svc.updateInvoice(s.ctx, invoiceId, { baseCents: 30_000 })).rejects.toMatchObject({ code: "has_payments" });
    await svc.updateInvoice(s.ctx, invoiceId, { number: "SOC-1b", dueOn: "2026-11-30", notes: "Recibida por correo" });
    expect(await svc.getInvoice(s.ctx, invoiceId)).toMatchObject({ number: "SOC-1b", dueOn: "2026-11-30", notes: "Recibida por correo" });
    expect((await svc.getInvoice(s.ctx, invoiceId)).events[0]).toMatchObject({
      action: "invoice_updated",
      detail: { fields: { number: { from: "SOC-1", to: "SOC-1b" }, dueOn: { from: "2026-10-22", to: "2026-11-30" } } },
    });

    await svc.createInvoice(s.ctx, s.materialId, invoice({ number: "SOC-2", baseCents: 100 }));
    await expect(svc.updateInvoice(s.ctx, invoiceId, { number: "SOC-2" })).rejects.toMatchObject({ code: "duplicate_number" });
  });

  it("never lowers an invoice below its credit notes, nor dates it after a payment", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice({ baseCents: 10_000 }));
    await svc.createInvoice(s.ctx, s.subId, { kind: "credit_note", number: "R", issuedOn: "2026-10-01", rectifiesId: invoiceId, baseCents: -8_000 });
    await expect(svc.updateInvoice(s.ctx, invoiceId, { baseCents: 5_000 })).rejects.toMatchObject({ code: "exceeds_amount" });
    await svc.updateInvoice(s.ctx, invoiceId, { baseCents: 9_000 });

    await svc.createPayment(s.ctx, invoiceId, { amountCents: 100, paidOn: "2026-09-25" });
    await expect(svc.updateInvoice(s.ctx, invoiceId, { issuedOn: "2026-09-30" })).rejects.toMatchObject({ code: "invalid_date" });
    await svc.updateInvoice(s.ctx, invoiceId, { issuedOn: "2026-09-25" });
  });

  it("deletes an invoice nothing was paid on and no credit note rectifies: its row and PDFs stay, out of every read", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice({ file: pdf() }));
    await svc.addInvoiceFile(s.ctx, invoiceId, { file: pdf("%PDF-1.7 v2"), note: "Faltaba el nº de pedido" });
    const credit = await svc.createInvoice(s.ctx, s.subId, { kind: "credit_note", number: "R", issuedOn: "2026-10-01", rectifiesId: invoiceId, baseCents: -1_000 });
    await expect(svc.deleteInvoice(s.ctx, invoiceId)).rejects.toMatchObject({ code: "has_invoices" });
    await svc.deleteInvoice(s.ctx, credit.invoiceId);

    const { paymentId } = await svc.createPayment(s.ctx, invoiceId, { amountCents: 100 });
    await expect(svc.deleteInvoice(s.ctx, invoiceId)).rejects.toMatchObject({ code: "has_payments" });
    await svc.deletePayment(s.ctx, paymentId);

    await svc.deleteInvoice(s.ctx, invoiceId);
    // A soft delete: the rows say who and when; their lines, PDF versions and files stay.
    const rows = await db.select().from(purchaseInvoices);
    expect(rows.map((r) => [r.number, r.deletedAt instanceof Date, r.deletedById]).sort()).toEqual([
      ["MSN-2026/112", true, s.ctx.userId],
      ["R", true, s.ctx.userId],
    ]);
    const versions = await db.select().from(purchaseInvoiceFiles).where(eq(purchaseInvoiceFiles.invoiceId, invoiceId));
    expect(versions).toHaveLength(2);
    expect(files.size).toBe(2);
    expect(versions.every((v) => files.has(v.pathname))).toBe(true);

    for (const attempt of [
      () => svc.getInvoice(s.ctx, invoiceId),
      () => svc.openInvoiceFile(s.ctx, invoiceId),
      () => svc.updateInvoice(s.ctx, invoiceId, { notes: "x" }),
      () => svc.addInvoiceFile(s.ctx, invoiceId, { file: pdf() }),
      () => svc.createPayment(s.ctx, invoiceId, { amountCents: 1 }),
      () => svc.createInvoice(s.ctx, s.subId, { kind: "credit_note", number: "R2", issuedOn: "2026-10-01", rectifiesId: invoiceId, baseCents: -1 }),
      () => svc.getInvoiceForm(s.ctx, { invoiceId }),
      // Twice: it is gone already.
      () => svc.deleteInvoice(s.ctx, invoiceId),
      () => svc.deleteInvoice(s.ctx, credit.invoiceId),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "not_found" });
    }
    expect((await svc.listInvoices(s.ctx)).invoices).toEqual([]);
    const order = await purchasingService.getPurchase(s.ctx, s.subId);
    expect(order.invoices).toEqual([]);
    expect(order.events[0]).toMatchObject({ action: "invoice_deleted", detail: { number: "MSN-2026/112" } });
  });

  it("versions the PDF, never deleting an older one", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice({ file: pdf("%PDF-1.7 v1") }));
    const { version } = await svc.addInvoiceFile(s.ctx, invoiceId, { file: pdf("%PDF-1.7 v2", "MSN-148.pdf"), note: "Faltaba el nº de pedido" });
    expect(version).toBe(2);
    const { files: versions } = await svc.getInvoice(s.ctx, invoiceId);
    expect(versions.map((f) => [f.version, f.note])).toEqual([
      [2, "Faltaba el nº de pedido"],
      [1, null],
    ]);
    expect(await svc.openInvoiceFile(s.ctx, invoiceId)).toMatchObject({ filename: "MSN-148.pdf" });
    expect(await svc.openInvoiceFile(s.ctx, invoiceId, versions[1]!.id)).toMatchObject({ filename: "Factura.pdf" });
    await expect(svc.addInvoiceFile(s.ctx, invoiceId, {})).rejects.toMatchObject({ code: "missing_file" });
  });
});

describe("setOrderMilestones", () => {
  it("splits the order's amount in turn; an invoiced milestone keeps its amount", async () => {
    const s = await setup();
    await expect(
      svc.setOrderMilestones(s.ctx, s.subId, { milestones: [{ concept: "Todo", amountCents: 1 }] }),
    ).rejects.toMatchObject({ code: "milestones_mismatch" });
    const [first, second] = await withMilestones(s);
    expect([first!.position, first!.progress, second!.concept]).toEqual([0, "contracted", "Fin de montaje"]);

    await svc.createInvoice(s.ctx, s.subId, invoice({ milestoneId: first!.id }));
    const resplit = (amounts: [number, number]) =>
      svc.setOrderMilestones(s.ctx, s.subId, {
        milestones: [
          { id: first!.id, concept: "Inicio", amountCents: amounts[0] },
          { id: second!.id, concept: "Fin", amountCents: amounts[1] },
        ],
      });
    await expect(resplit([40_000, 58_000])).rejects.toMatchObject({ code: "has_invoices" });
    await expect(svc.setOrderMilestones(s.ctx, s.subId, { milestones: [] })).rejects.toMatchObject({ code: "has_invoices" });

    // The others may change, split or go.
    await svc.setOrderMilestones(s.ctx, s.subId, {
      milestones: [
        { id: first!.id, concept: "Inicio", amountCents: 49_000 },
        { concept: "Entrega", amountCents: 29_000 },
        { concept: "Recepción", amountCents: 20_000 },
      ],
    });
    const order = await purchasingService.getPurchase(s.ctx, s.subId);
    expect(order.milestones.map((m) => [m.concept, m.amountCents, m.progress])).toEqual([
      ["Inicio", 49_000, "invoiced"],
      ["Entrega", 29_000, "contracted"],
      ["Recepción", 20_000, "contracted"],
    ]);
    expect(order.events[0]).toMatchObject({ action: "milestones" });
  });
});

describe("an edit and the payment schedule", () => {
  const edit = (s: Setup, amountCents: number, ctx = s.admin) =>
    purchasingService.updatePurchase(ctx, s.subId, { lines: [{ lineageId: s.lineage("03"), amountCents }] });
  const schedule = async (s: Setup) => {
    const order = await purchasingService.getPurchase(s.admin, s.subId);
    expect(order.milestones.length === 0 || order.milestones.reduce((sum, m) => sum + m.amountCents, 0) === order.amountCents).toBe(true);
    return { order, shown: order.milestones.map((m) => [m.concept, m.amountCents]) };
  };

  it("a rise becomes a milestone of its own, logged with the edit", async () => {
    const s = await setup();
    await withMilestones(s);
    await edit(s, 100_000);
    const { order, shown } = await schedule(s);
    expect(order.amountCents).toBe(100_000);
    expect(shown).toEqual([
      ["Inicio de fabricación", 49_000],
      ["Fin de montaje", 49_000],
      ["Ajuste por corrección del pedido", 2_000],
    ]);
    expect(order.milestones.map((m) => m.position)).toEqual([0, 1, 2]);
    expect(order.events[0]).toMatchObject({
      action: "lines",
      detail: { changes: [{ from: { amountCents: 98_000 }, to: { amountCents: 100_000 } }], scheduleDeltaCents: 2_000 },
    });
  });

  it("a cut comes off the last milestones not invoiced, which go when nothing is left of them", async () => {
    const s = await setup();
    const [first] = await withMilestones(s);
    await svc.createInvoice(s.admin, s.subId, invoice({ baseCents: 10_000, milestoneId: first!.id }));
    await edit(s, 100_000);
    // 400 € off: the 20 € of the rise go, and 380 € come off Fin de montaje.
    await edit(s, 60_000);
    let { order, shown } = await schedule(s);
    expect(shown).toEqual([
      ["Inicio de fabricación", 49_000],
      ["Fin de montaje", 11_000],
    ]);
    expect(order.events[0]).toMatchObject({ action: "lines", detail: { scheduleDeltaCents: -40_000 } });
    // Down to the invoiced milestone: the other one goes.
    await edit(s, 49_000);
    ({ order, shown } = await schedule(s));
    expect(order.amountCents).toBe(49_000);
    expect(shown).toEqual([["Inicio de fabricación", 49_000]]);
  });

  it("a cut the milestones not invoiced can't take fails, and nothing changes", async () => {
    const s = await setup();
    const [first] = await withMilestones(s);
    await svc.createInvoice(s.admin, s.subId, invoice({ baseCents: 10_000, milestoneId: first!.id }));
    const before = await purchasingService.getPurchase(s.admin, s.subId);
    // 580 € off, and only Fin de montaje (490 €) is free; the line itself stays above its 100 € invoiced.
    await expect(
      purchasingService.updatePurchase(s.admin, s.subId, { notes: "Recorte", lines: [{ lineageId: s.lineage("03"), amountCents: 40_000 }] }),
    ).rejects.toMatchObject({ code: "milestones_cut" });
    const after = await purchasingService.getPurchase(s.admin, s.subId);
    expect(after.amountCents).toBe(98_000);
    expect(after.notes).toBe(before.notes);
    expect(after.lines.map((l) => [l.lineageId, l.amountCents])).toEqual([[s.lineage("03"), 98_000]]);
    expect(after.milestones.map((m) => [m.id, m.position, m.concept, m.amountCents])).toEqual(
      before.milestones.map((m) => [m.id, m.position, m.concept, m.amountCents]),
    );
    expect(after.events.map((e) => e.id)).toEqual(before.events.map((e) => e.id));
  });

  it("an edit that keeps the amount leaves the schedule alone", async () => {
    const s = await setup();
    const milestones = await withMilestones(s);
    // Split again between two lines, a line that no longer closes, and other fields: 980 € all the same.
    await purchasingService.updatePurchase(s.admin, s.subId, {
      notes: "Portes incluidos",
      workStart: "2026-07-01",
      lines: [
        { lineageId: s.lineage("03"), amountCents: 90_000, closesLine: false },
        { lineageId: s.lineage("02"), amountCents: 8_000 },
      ],
    });
    const { order } = await schedule(s);
    expect(order.amountCents).toBe(98_000);
    expect(order.milestones.map((m) => [m.id, m.concept, m.amountCents])).toEqual(milestones.map((m) => [m.id, m.concept, m.amountCents]));
    const lines = order.events.find((e) => e.action === "lines")!;
    expect(lines.detail.changes).toHaveLength(2);
    expect(lines.detail).not.toHaveProperty("scheduleDeltaCents");
  });

  it("an order without a schedule gets none", async () => {
    const s = await setup();
    await edit(s, 100_000);
    await edit(s, 60_000);
    const { order } = await schedule(s);
    expect(order.amountCents).toBe(60_000);
    expect(order.milestones).toEqual([]);
    expect(order.events.filter((e) => e.action === "lines").map((e) => "scheduleDeltaCents" in e.detail)).toEqual([false, false]);
  });

  it("is for the tenant's admins and managers only", async () => {
    const s = await setup("viewer");
    const milestones = await withMilestones({ ...s, ctx: s.admin });
    await expect(edit(s, 100_000, s.ctx)).rejects.toMatchObject({ code: "forbidden" });
    const other = await createTestTenant();
    const intruder: Ctx = { tenantId: other.id, userId: (await createTestUser(other.id, { role: "admin" })).id, role: "admin" };
    await expect(edit(s, 100_000, intruder)).rejects.toMatchObject({ code: "not_found" });
    const { order } = await schedule(s);
    expect(order.amountCents).toBe(98_000);
    expect(order.milestones.map((m) => [m.id, m.amountCents])).toEqual(milestones.map((m) => [m.id, m.amountCents]));
  });
});

describe("the order and its invoices", () => {
  it("shows its invoicing and terms, and keeps an invoiced order's supplier, lines and place", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice());
    await svc.createPayment(s.ctx, invoiceId, { amountCents: 46_550 });
    const order = await purchasingService.getPurchase(s.ctx, s.subId);
    expect(order).toMatchObject({
      invoicedCents: 49_000,
      terms: { paymentDays: 30, retentionBp: 500, vatKind: "reverse_charge" },
      invoicing: { invoicedCents: 49_000, paidCents: 46_550, outstandingCents: 0, retainedCents: 2_450, toInvoiceCents: 49_000 },
      invoices: [{ id: invoiceId, state: "paid" }],
    });

    await expect(purchasingService.setPurchaseStatus(s.admin, s.subId, { status: "cancelled" })).rejects.toMatchObject({ code: "has_invoices" });
    await expect(purchasingService.setPurchaseStatus(s.admin, s.subId, { status: "pending" })).rejects.toMatchObject({ code: "has_invoices" });
    await purchasingService.setPurchaseStatus(s.admin, s.subId, { status: "finished" });

    const { id: other } = await subcontractorsService.createSubcontractor(s.admin, company({ legalName: "Otra S.L.", taxId: [..."0123456789"].map((c) => `B3900000${c}`).find(isValidCif) }));
    await expect(purchasingService.updatePurchase(s.admin, s.subId, { subcontractorId: other })).rejects.toMatchObject({ code: "has_invoices" });
    await expect(
      purchasingService.updatePurchase(s.admin, s.subId, { lines: [{ lineageId: s.lineage("02"), amountCents: 1_000 }] }),
    ).rejects.toMatchObject({ code: "has_invoices" });
    // Adding a line or changing its terms is fine.
    await purchasingService.updatePurchase(s.admin, s.subId, {
      paymentDays: 60,
      vatKind: "vat21",
      lines: [
        { lineageId: s.lineage("03"), amountCents: 98_000 },
        { lineageId: s.lineage("02"), amountCents: 1_000 },
      ],
    });
    expect((await purchasingService.getPurchase(s.ctx, s.subId)).terms).toEqual({ paymentDays: 60, retentionBp: 500, vatKind: "vat21" });
    expect((await purchasingService.getPurchaseForm(s.ctx, s.project.id, s.subId)).editing).toMatchObject({
      paymentDays: 60,
      vatKind: "vat21",
    });
  });

  it("lists each order's invoiced base", async () => {
    const s = await setup();
    await svc.createInvoice(s.ctx, s.subId, invoice());
    const { orders } = await purchasingService.getProjectPurchases(s.ctx, s.project.id);
    expect(orders.find((o) => o.id === s.subId)?.invoicedCents).toBe(49_000);
    expect(orders.find((o) => o.id === s.materialId)?.invoicedCents).toBe(0);
  });
});

describe("getProjectPurchaseLines", () => {
  it("follows each line through the four states, with the obra's totals and invoices due", async () => {
    const s = await setup();
    // 01 and 02: the material order, 03: the subcontract. Pay 01/02's invoice in full, 03 half invoiced.
    const material = await svc.createInvoice(s.ctx, s.materialId, invoice({ number: "SOC-1", baseCents: 145_000, dueOn: "2026-10-15" }));
    let view = await purchasingService.getProjectPurchaseLines(s.ctx, s.project.id);
    expect(view.dueAlerts.map((i) => [i.number, i.state])).toEqual([["SOC-1", "overdue"]]);
    expect(view.chapters.find((c) => c.code === "01")!.lines[0]).toMatchObject({ progress: "invoiced", overdue: true });

    const { payableCents } = await svc.getInvoice(s.ctx, material.invoiceId);
    await svc.createPayment(s.ctx, material.invoiceId, { amountCents: payableCents });
    const [first] = await withMilestones(s);
    await svc.createInvoice(s.ctx, s.subId, invoice({ milestoneId: first!.id }));

    view = await purchasingService.getProjectPurchaseLines(s.ctx, s.project.id);
    const line = (code: string) => view.chapters.find((c) => c.code === code)!.lines[0]!;
    expect(line("01")).toMatchObject({
      progress: "paid",
      costCents: 100_000,
      contractedCents: 95_000,
      deviationCents: -5_000,
      invoicedCents: 95_000,
      paidCents: 95_000,
      outstandingCents: 0,
      overdue: false,
    });
    expect(line("03")).toMatchObject({
      progress: "invoiced",
      invoicedCents: 49_000,
      outstandingCents: 46_550,
      retainedCents: 2_450,
      orders: [{ number: 1, lineAmountCents: 98_000, milestones: [{ progress: "invoiced" }, { progress: "contracted" }] }],
    });
    expect(view.counts).toEqual({ to_contract: 0, contracted: 0, invoiced: 1, paid: 2 });
    expect(view.summary).toMatchObject({
      costCents: 300_000,
      contractedCents: 243_000,
      invoicedCents: 194_000,
      paidCents: 145_000,
      outstandingCents: 46_550,
      retainedCents: 2_450,
      overdueCents: 0,
      invoices: 2,
      creditNotes: 0,
    });
    expect(view.dueAlerts.map((i) => i.number)).toEqual(["MSN-2026/112"]);
  });

  it("shows a line nobody ordered as to contract, and one with an order but no invoice as contracted", async () => {
    const s = await setup();
    await purchasingService.setPurchaseStatus(s.admin, s.subId, { status: "cancelled" });
    const view = await purchasingService.getProjectPurchaseLines(s.ctx, s.project.id);
    const line = (code: string) => view.chapters.find((c) => c.code === code)!.lines[0]!;
    expect(line("03")).toMatchObject({ progress: "to_contract", contractedCents: 0, uncontractedCents: 100_000, orders: [] });
    expect(line("01")).toMatchObject({ progress: "contracted", orders: [{ lineAmountCents: 95_000, amountCents: 145_000 }] });
  });
});

describe("a deleted invoice or payment", () => {
  /** Everything Compras shows of the money, without the orders' history. */
  const figures = async (s: Setup) => {
    const order = await purchasingService.getPurchase(s.ctx, s.subId);
    return {
      order: { ...order, events: null },
      lines: await purchasingService.getProjectPurchaseLines(s.ctx, s.project.id),
      form: await svc.getInvoiceForm(s.ctx, { orderId: s.subId }),
      orders: await purchasingService.listPurchases(s.ctx),
      invoices: await svc.listInvoices(s.ctx),
      payments: await svc.listPayments(s.ctx),
      counts: await svc.getPurchasingCounts(s.ctx),
      suppliers: await purchaseSuppliersService.listSuppliers(s.ctx),
      supplier: await purchaseSuppliersService.getSupplierPurchasing(s.ctx, s.subcontractorId),
    };
  };

  it("leaves the order, its line, its supplier and the counters exactly as before the invoice existed", async () => {
    const s = await setup();
    const [first] = await withMilestones(s);
    const before = await figures(s);
    expect(before.counts).toEqual({ requests: 0, orders: 2, invoices: 0, payments: 0, suppliers: 2, dueAttention: 0 });

    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice({ milestoneId: first!.id, dueOn: "2026-10-15", file: pdf() }));
    const invoiced = await figures(s);
    expect(invoiced.counts).toMatchObject({ invoices: 1, dueAttention: 1 });
    expect(invoiced.order).toMatchObject({ invoicedCents: 49_000, invoicing: { invoicedCents: 49_000, outstandingCents: 46_550 } });
    expect(invoiced.order.milestones[0]).toMatchObject({ progress: "invoiced" });
    expect(invoiced.lines.chapters.find((c) => c.code === "03")!.lines[0]).toMatchObject({ progress: "invoiced", overdue: true });
    expect(invoiced.suppliers.suppliers[0]).toMatchObject({ id: s.subcontractorId, invoicedCents: 49_000, outstandingCents: 46_550, overdueCents: 46_550 });

    await svc.deleteInvoice(s.ctx, invoiceId);
    const after = await figures(s);
    expect(after).toEqual(before);
    expect(after.order).toMatchObject({ invoicedCents: 0, invoices: [], invoicing: { invoicedCents: 0, outstandingCents: 0, toInvoiceCents: 98_000 } });
    expect(after.lines.chapters.find((c) => c.code === "03")!.lines[0]).toMatchObject({ progress: "contracted", invoicedCents: 0, overdue: false });
    expect(after.lines.dueAlerts).toEqual([]);
  });

  it("frees its number for that supplier, and the milestone it invoiced", async () => {
    const s = await setup();
    const [first, second] = await withMilestones(s);
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice({ milestoneId: first!.id }));
    await expect(svc.createInvoice(s.ctx, s.subId, invoice({ milestoneId: second!.id }))).rejects.toMatchObject({ code: "duplicate_number" });
    await expect(svc.setOrderMilestones(s.ctx, s.subId, { milestones: [] })).rejects.toMatchObject({ code: "has_invoices" });

    await svc.deleteInvoice(s.ctx, invoiceId);
    // Invoiced only by the deleted invoice: the milestone can change its amount, or go with the whole schedule.
    await svc.setOrderMilestones(s.ctx, s.subId, {
      milestones: [
        { id: first!.id, concept: "Inicio", amountCents: 40_000 },
        { id: second!.id, concept: "Fin", amountCents: 58_000 },
      ],
    });
    await svc.setOrderMilestones(s.ctx, s.subId, { milestones: [] });
    expect((await purchasingService.getPurchase(s.ctx, s.subId)).milestones).toEqual([]);
    // The deleted invoice is still there, without the milestone that went.
    const [row] = await db.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, invoiceId));
    expect(row).toMatchObject({ number: "MSN-2026/112", baseCents: 49_000, milestoneId: null, deletedAt: expect.any(Date) });

    // The same number again, and once more after an edit takes it.
    const again = await svc.createInvoice(s.ctx, s.subId, invoice());
    expect(again.invoiceId).not.toBe(invoiceId);
    await svc.deleteInvoice(s.ctx, again.invoiceId);
    const other = await svc.createInvoice(s.ctx, s.subId, invoice({ number: "MSN-2026/113" }));
    await svc.updateInvoice(s.ctx, other.invoiceId, { number: "MSN-2026/112" });
    expect((await svc.listInvoices(s.ctx)).invoices.map((i) => i.number)).toEqual(["MSN-2026/112"]);
    expect(await db.select({ id: purchaseInvoices.id }).from(purchaseInvoices)).toHaveLength(3);
  });

  it("no longer keeps the order placed, its lines above what it invoiced, nor a milestone from a cut", async () => {
    const s = await setup();
    const [first, second] = await withMilestones(s);
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice({ milestoneId: second!.id }));
    const lower = (amountCents: number) => purchasingService.updatePurchase(s.admin, s.subId, { lines: [{ lineageId: s.lineage("03"), amountCents }] });
    await expect(lower(40_000)).rejects.toMatchObject({ code: "below_invoiced" });
    await expect(purchasingService.setPurchaseStatus(s.admin, s.subId, { status: "cancelled" })).rejects.toMatchObject({ code: "has_invoices" });
    const { id: otherId } = await subcontractorsService.createSubcontractor(s.admin, company({ legalName: "Estructuras Besaya S.L.", taxId: "B39811831" }));
    await expect(purchasingService.updatePurchase(s.admin, s.subId, { subcontractorId: otherId })).rejects.toMatchObject({ code: "has_invoices" });

    await svc.deleteInvoice(s.ctx, invoiceId);
    // 580 € off: the last milestone (invoiced only by the deleted invoice) goes whole, and 90 € come off the first.
    await lower(40_000);
    const order = await purchasingService.getPurchase(s.admin, s.subId);
    expect(order.milestones.map((m) => [m.id, m.amountCents])).toEqual([[first!.id, 40_000]]);
    await purchasingService.updatePurchase(s.admin, s.subId, { subcontractorId: otherId });
    await purchasingService.setPurchaseStatus(s.admin, s.subId, { status: "cancelled" });
    expect(await purchasingService.getPurchase(s.admin, s.subId)).toMatchObject({ status: "cancelled", subcontractorId: otherId });
  });

  it("owes the invoice again once its payment is deleted", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice({ dueOn: "2026-10-15" }));
    const detail = async () => ({ ...(await svc.getInvoice(s.ctx, invoiceId)), events: null });
    const before = { figures: await figures(s), detail: await detail() };
    expect(before.detail).toMatchObject({ state: "overdue", outstandingCents: 46_550 });
    expect(before.figures.counts).toMatchObject({ payments: 0, dueAttention: 1 });

    const { paymentId } = await svc.createPayment(s.ctx, invoiceId, { amountCents: 46_550, paidOn: "2026-10-10", file: pdf() });
    expect(await detail()).toMatchObject({ state: "paid", paidCents: 46_550, outstandingCents: 0 });
    expect(await svc.getPurchasingCounts(s.ctx)).toMatchObject({ payments: 1, dueAttention: 0 });
    expect((await svc.listInvoices(s.ctx)).summary).toMatchObject({ outstandingCents: 0, paidThisMonthCents: 46_550, paymentsThisMonth: 1 });
    // Paid: its amounts are fixed, and it can't be dated after the payment.
    await expect(svc.updateInvoice(s.ctx, invoiceId, { baseCents: 48_000 })).rejects.toMatchObject({ code: "has_payments" });
    await expect(svc.updateInvoice(s.ctx, invoiceId, { issuedOn: "2026-10-12" })).rejects.toMatchObject({ code: "invalid_date" });

    await svc.deletePayment(s.ctx, paymentId);
    expect({ figures: await figures(s), detail: await detail() }).toEqual(before);
    expect((await svc.listPayments(s.ctx)).forecast[0]).toMatchObject({ from: null, totalCents: 46_550, invoices: [{ id: invoiceId }] });
    // Nothing paid any more: all of it can be paid again, its amounts change and it can go.
    await svc.updateInvoice(s.ctx, invoiceId, { issuedOn: "2026-10-12", dueOn: "2026-10-15" });
    await svc.updateInvoice(s.ctx, invoiceId, { baseCents: 48_000 });
    await svc.createPayment(s.ctx, invoiceId, { amountCents: 48_000 });
    await expect(svc.createPayment(s.ctx, invoiceId, { amountCents: 1 })).rejects.toMatchObject({ code: "exceeds_amount" });
  });

  it("a deleted credit note takes nothing off its invoice, and leaves its room and its number", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice({ baseCents: 10_000, dueOn: "2026-10-15" }));
    const credit = (baseCents: number, number = "R-1") =>
      svc.createInvoice(s.ctx, s.subId, { kind: "credit_note", number, issuedOn: "2026-10-01", rectifiesId: invoiceId, baseCents });
    const whole = await credit(-10_000);
    expect(await svc.getInvoice(s.ctx, invoiceId)).toMatchObject({ outstandingCents: 0, state: "paid", creditNotes: [{ number: "R-1" }] });
    expect((await svc.getPurchasingCounts(s.ctx)).dueAttention).toBe(0);
    await expect(credit(-1, "R-2")).rejects.toMatchObject({ code: "exceeds_amount" });

    await svc.deleteInvoice(s.ctx, whole.invoiceId);
    expect(await svc.getInvoice(s.ctx, invoiceId)).toMatchObject({ outstandingCents: 9_500, state: "overdue", creditNotes: [], payableLeftCents: 10_000 });
    expect(await svc.getPurchasingCounts(s.ctx)).toMatchObject({ invoices: 1, dueAttention: 1 });
    expect((await svc.listInvoices(s.ctx)).invoices.map((i) => [i.number, i.outstandingCents])).toEqual([["MSN-2026/112", 9_500]]);
    expect((await purchasingService.getPurchase(s.ctx, s.subId)).invoicing).toMatchObject({ invoicedCents: 10_000 });
    // All of it can be paid: the deleted credit note settles none of it.
    const { paymentId } = await svc.createPayment(s.ctx, invoiceId, { amountCents: 10_000 });
    await svc.deletePayment(s.ctx, paymentId);
    // The invoice may go down to nothing again (the deleted credit note took none of it), with the same number.
    await svc.updateInvoice(s.ctx, invoiceId, { baseCents: 4_000 });
    const partial = await credit(-4_000);
    expect(await svc.getInvoice(s.ctx, invoiceId)).toMatchObject({ outstandingCents: 0, creditNotes: [{ id: partial.invoiceId, number: "R-1" }] });
    // Only the credit note still there keeps the invoice.
    await expect(svc.deleteInvoice(s.ctx, invoiceId)).rejects.toMatchObject({ code: "has_invoices" });
    await svc.deleteInvoice(s.ctx, partial.invoiceId);
    await svc.deleteInvoice(s.ctx, invoiceId);
    expect((await svc.listInvoices(s.ctx)).invoices).toEqual([]);
  });
});

describe("a deleted obra", () => {
  /** A second obra of the tenant: one order of the same subcontractor, an invoice due soon and a payment. */
  async function secondObra(s: Setup) {
    const project = await createTestProject(s.tenant.id);
    const { revisionId } = await framerDraft(s.admin, project.id, ["01"]);
    await budgetService.acceptRevision(s.admin, project.id, revisionId, {}, { unissued: true });
    const form = await purchasingService.getPurchaseForm(s.admin, project.id);
    const { orderId } = await purchasingService.createPurchase(s.admin, project.id, {
      kind: "subcontract",
      subcontractorId: s.subcontractorId,
      description: "Cimentación",
      status: "contracted",
      orderedOn: "2026-07-01",
      lines: [{ lineageId: form.chapters[0]!.lines[0]!.lineageId, amountCents: 20_000 }],
    });
    const { invoiceId } = await svc.createInvoice(s.admin, orderId, invoice({ number: "MSN-2", baseCents: 20_000, dueOn: "2026-10-22" }));
    await svc.createPayment(s.admin, invoiceId, { amountCents: 5_000, paidOn: "2026-10-05" });
    return { project, orderId, invoiceId };
  }

  it("has its orders, invoices and payments left out of the tenant's lists, totals and counters, and unreachable by their id", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice({ dueOn: "2026-10-15", file: pdf() }));
    const { paymentId } = await svc.createPayment(s.ctx, invoiceId, { amountCents: 100, paidOn: "2026-10-02", file: pdf() });
    const second = await secondObra(s);
    expect(await svc.getPurchasingCounts(s.ctx)).toEqual({ requests: 0, orders: 3, invoices: 2, payments: 2, suppliers: 2, dueAttention: 2 });

    await db.update(projects).set({ deletedAt: new Date(), deletedById: s.admin.userId }).where(eq(projects.id, s.project.id));

    expect(await svc.getPurchasingCounts(s.ctx)).toEqual({ requests: 0, orders: 1, invoices: 1, payments: 1, suppliers: 2, dueAttention: 1 });
    const invoices = await svc.listInvoices(s.ctx);
    expect(invoices.invoices.map((i) => i.id)).toEqual([second.invoiceId]);
    expect(invoices.projects.map((p) => p.id)).toEqual([second.project.id]);
    expect(invoices.summary).toMatchObject({ outstandingCents: 15_000, outstandingInvoices: 1, overdueCents: 0, paidThisMonthCents: 5_000, paymentsThisMonth: 1 });
    const payments = await svc.listPayments(s.ctx);
    expect(payments.payments.map((p) => [p.invoiceNumber, p.amountCents])).toEqual([["MSN-2", 5_000]]);
    expect(payments.forecast.flatMap((week) => week.invoices.map((i) => i.id))).toEqual([second.invoiceId]);
    expect(payments.summary).toEqual({ monthCents: 5_000, monthPayments: 1 });
    const orders = await purchasingService.listPurchases(s.ctx);
    expect(orders.orders.map((o) => o.id)).toEqual([second.orderId]);
    expect(orders.projects.map((p) => p.id)).toEqual([second.project.id]);
    expect(orders.summary).toMatchObject({ yearContractedCents: 20_000, yearOrders: 1, yearProjects: 1 });
    expect((await svc.getInvoiceForm(s.ctx)).orders.map((o) => o.id)).toEqual([second.orderId]);

    const { suppliers, summary } = await purchaseSuppliersService.listSuppliers(s.ctx);
    expect(suppliers.map((x) => [x.id, x.orders, x.contractedCents, x.invoicedCents, x.outstandingCents])).toEqual([
      [s.subcontractorId, 1, 20_000, 20_000, 15_000],
      [s.supplierId, 0, 0, 0, 0],
    ]);
    expect(summary).toMatchObject({ active: 1, contractedCents: 20_000, outstandingCents: 15_000 });
    const supplier = await purchaseSuppliersService.getSupplierPurchasing(s.ctx, s.subcontractorId);
    expect(supplier.orders.map((o) => o.id)).toEqual([second.orderId]);
    expect(supplier.invoices.map((i) => i.id)).toEqual([second.invoiceId]);
    expect(supplier.payments).toHaveLength(1);
    expect((await purchasingService.listSupplierOrders(s.ctx, s.supplierId))).toEqual([]);

    for (const attempt of [
      () => purchasingService.getPurchase(s.ctx, s.subId),
      () => purchasingService.updatePurchase(s.ctx, s.subId, { notes: "x" }),
      () => purchasingService.setPurchaseStatus(s.ctx, s.subId, { status: "finished" }),
      () => svc.getInvoice(s.ctx, invoiceId),
      () => svc.getInvoiceForm(s.ctx, { orderId: s.subId }),
      () => svc.openInvoiceFile(s.ctx, invoiceId),
      () => svc.openPaymentFile(s.ctx, paymentId),
      () => svc.createInvoice(s.ctx, s.subId, invoice({ number: "Z" })),
      () => svc.updateInvoice(s.ctx, invoiceId, { notes: "x" }),
      () => svc.addInvoiceFile(s.ctx, invoiceId, { file: pdf() }),
      () => svc.createPayment(s.ctx, invoiceId, { amountCents: 1 }),
      () => svc.deletePayment(s.ctx, paymentId),
      () => svc.deleteInvoice(s.ctx, invoiceId),
      () => svc.setOrderMilestones(s.ctx, s.subId, { milestones: [] }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "not_found" });
    }
    // Nothing was written on them.
    expect(await db.select().from(purchasePayments).where(eq(purchasePayments.id, paymentId))).toMatchObject([{ deletedAt: null }]);
    expect(await db.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, invoiceId))).toMatchObject([{ deletedAt: null, notes: null }]);
  });
});

describe("Administration's lists", () => {
  it("lists invoices owed first, soonest due first, with what is owed, past due and due soon", async () => {
    const s = await setup();
    const overdue = await svc.createInvoice(s.ctx, s.materialId, invoice({ number: "SOC-1", baseCents: 10_000, dueOn: "2026-10-15" }));
    await svc.createInvoice(s.ctx, s.subId, invoice({ dueOn: "2026-10-22" }));
    const paid = await svc.createInvoice(s.ctx, s.materialId, invoice({ number: "SOC-2", baseCents: 1_000, dueOn: "2026-11-30" }));
    await svc.createPayment(s.ctx, paid.invoiceId, { amountCents: 1_210, paidOn: "2026-10-02" });

    const list = await svc.listInvoices(s.ctx);
    expect(list.invoices.map((i) => [i.number, i.state])).toEqual([
      ["SOC-1", "overdue"],
      ["MSN-2026/112", "pending"],
      ["SOC-2", "paid"],
    ]);
    expect(list.summary).toEqual({
      outstandingCents: 12_100 + 46_550,
      outstandingInvoices: 2,
      outstandingSuppliers: 2,
      overdueCents: 12_100,
      overdueInvoices: 1,
      dueSoonCents: 46_550,
      dueSoonInvoices: 1,
      paidThisMonthCents: 1_210,
      paymentsThisMonth: 1,
    });
    expect(list.projects).toHaveLength(1);
    expect((await svc.listInvoices(s.ctx, { subcontractorId: s.subcontractorId })).invoices).toHaveLength(1);
    expect((await svc.listInvoices(s.ctx, { projectId: "other" })).invoices).toHaveLength(0);

    const payments = await svc.listPayments(s.ctx);
    expect(payments.forecast[0]).toMatchObject({ from: null, totalCents: 12_100, invoices: [{ id: overdue.invoiceId }] });
    expect(payments.forecast[1]).toMatchObject({ from: "2026-10-19", to: "2026-10-25", totalCents: 46_550 });
    expect(payments.payments).toMatchObject([{ invoiceNumber: "SOC-2", amountCents: 1_210 }]);
    expect(payments.summary).toEqual({ monthCents: 1_210, monthPayments: 1 });

    expect(await svc.getPurchasingCounts(s.ctx)).toEqual({ requests: 0, orders: 2, invoices: 3, payments: 1, suppliers: 2, dueAttention: 2 });
  });

  it("gives the invoice form the orders to invoice and the chosen one's schedule, lines and invoices", async () => {
    const s = await setup();
    const [first] = await withMilestones(s);
    await svc.createInvoice(s.ctx, s.subId, invoice({ milestoneId: first!.id }));
    const form = await svc.getInvoiceForm(s.ctx, { orderId: s.subId });
    expect(form.orders.map((o) => [o.number, o.amountCents, o.invoicedCents])).toEqual([
      [2, 145_000, 0],
      [1, 98_000, 49_000],
    ]);
    expect(form.order).toMatchObject({
      kind: "subcontract",
      supplierKind: "company",
      amountCents: 98_000,
      terms: { vatKind: "reverse_charge", retentionBp: 500 },
      milestones: [{ progress: "invoiced" }, { progress: "contracted" }],
      lines: [{ chapterCode: "03", amountCents: 98_000, invoicedCents: 49_000 }],
      invoicing: { toInvoiceCents: 49_000 },
    });
    expect((await svc.getInvoiceForm(s.ctx)).order).toBeNull();
    await expect(svc.getInvoiceForm(s.ctx, { orderId: "nope" })).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("Administration's lists, a page at a time", () => {
  /**
   * Five invoices read by a viewer, as the list orders them: SOC-1 past due,
   * MSN-2026/112 due soon, SOC-3 part paid with a credit note (SOC-R1) and
   * SOC-2 paid. Besides, an invoice and a payment deleted, an invoice of a
   * deleted obra and one of another tenant, which nothing may show.
   */
  async function many() {
    const s = await setup("viewer");
    const { admin } = s;
    const overdue = await svc.createInvoice(admin, s.materialId, invoice({ number: "SOC-1", baseCents: 10_000, dueOn: "2026-10-15" }));
    const soon = await svc.createInvoice(admin, s.subId, invoice({ dueOn: "2026-10-22" }));
    const paid = await svc.createInvoice(admin, s.materialId, invoice({ number: "SOC-2", issuedOn: "2026-09-25", baseCents: 1_000, dueOn: "2026-11-30" }));
    await svc.createPayment(admin, paid.invoiceId, { amountCents: 1_210, paidOn: "2026-10-02" });
    const partial = await svc.createInvoice(admin, s.materialId, invoice({ number: "SOC-3", baseCents: 20_000, dueOn: "2026-11-10" }));
    await svc.createPayment(admin, partial.invoiceId, { amountCents: 5_000, paidOn: "2026-10-10" });
    const credit = await svc.createInvoice(admin, s.materialId, invoice({ kind: "credit_note", rectifiesId: partial.invoiceId, number: "SOC-R1", issuedOn: "2026-10-01", baseCents: -2_000 }));

    // Deleted by a user: an invoice past due, and a payment that would have settled the one due soon.
    const removed = await svc.createInvoice(admin, s.materialId, invoice({ number: "SOC-4", baseCents: 3_000, dueOn: "2026-09-30" }));
    await svc.deleteInvoice(admin, removed.invoiceId);
    const mistaken = await svc.createPayment(admin, soon.invoiceId, { amountCents: 46_550, paidOn: "2026-10-05" });
    await svc.deletePayment(admin, mistaken.paymentId);

    // A deleted obra with an invoice past due and a payment this month.
    const gone = await createTestProject(s.tenant.id);
    const { revisionId } = await framerDraft(admin, gone.id, ["01"]);
    await budgetService.acceptRevision(admin, gone.id, revisionId, {}, { unissued: true });
    const goneLine = (await purchasingService.getPurchaseForm(admin, gone.id)).chapters[0]!.lines[0]!.lineageId;
    const goneOrder = await purchasingService.createPurchase(admin, gone.id, {
      kind: "material",
      subcontractorId: s.supplierId,
      description: "Piedra de la obra borrada",
      status: "ordered",
      orderedOn: "2026-06-01",
      lines: [{ lineageId: goneLine, amountCents: 40_000 }],
    });
    const goneInvoice = await svc.createInvoice(admin, goneOrder.orderId, invoice({ number: "SOC-9", baseCents: 40_000, dueOn: "2026-10-01" }));
    await svc.createPayment(admin, goneInvoice.invoiceId, { amountCents: 100, paidOn: "2026-10-03" });
    await projectsService.deleteProject(admin, gone.id);

    const other = await setup();
    await svc.createInvoice(other.ctx, other.materialId, invoice({ number: "SOC-1", baseCents: 99_000, dueOn: "2026-10-01" }));

    // Owed first, soonest due first; then the settled ones, newest first.
    const ids = [overdue, soon, partial, credit, paid].map((i) => i.invoiceId);
    return { ...s, other, ids, gone };
  }

  const idsOf = (list: { invoices: { id: string }[] }) => list.invoices.map((i) => i.id);
  const SUMMARY = {
    // 12.100 past due + 46.550 due soon + 16.780 (24.200 less its credit note's 2.420 and the 5.000 paid).
    outstandingCents: 75_430,
    outstandingInvoices: 3,
    outstandingSuppliers: 2,
    overdueCents: 12_100,
    overdueInvoices: 1,
    dueSoonCents: 46_550,
    dueSoonInvoices: 1,
    paidThisMonthCents: 6_210,
    paymentsThisMonth: 2,
  };

  it("gives the whole list when no page is asked for, as before", async () => {
    const s = await many();
    const all = await svc.listInvoices(s.ctx);

    expect(all.invoices.map((i) => [i.number, i.state, i.outstandingCents])).toEqual([
      ["SOC-1", "overdue", 12_100],
      ["MSN-2026/112", "pending", 46_550],
      ["SOC-3", "partial", 16_780],
      ["SOC-R1", "credit", 0],
      ["SOC-2", "paid", 0],
    ]);
    expect(idsOf(all)).toEqual(s.ids);
    expect(all.paging).toEqual({ page: 1, limit: 5000, total: 5, pages: 1 });
    expect(all.groupCounts).toEqual({ all: 5, open: 3, overdue: 1, paid: 1, credit: 1 });
    expect(all.suppliers).toEqual([
      { id: s.subcontractorId, name: "Montajes Steel Norte S.L." },
      { id: s.supplierId, name: "Piedra de Liébana S.L." },
    ]);
    expect(all.summary).toEqual(SUMMARY);
    expect(all.invoices[3]).toMatchObject({ rectifiesNumber: "SOC-3", kind: "credit_note" });
  });

  it("cuts pages in a stable order: first, next, last and beyond the end", async () => {
    const s = await many();
    const page = (n: number) => svc.listInvoices(s.ctx, {}, { page: n, limit: 2 });

    const [first, next, last, beyond] = await Promise.all([page(1), page(2), page(3), page(4)]);
    expect(idsOf(first)).toEqual(s.ids.slice(0, 2));
    expect(idsOf(next)).toEqual(s.ids.slice(2, 4));
    expect(idsOf(last)).toEqual(s.ids.slice(4));
    expect(idsOf(beyond)).toEqual([]);
    expect(first.paging).toEqual({ page: 1, limit: 2, total: 5, pages: 3 });
    expect(beyond.paging).toEqual({ page: 4, limit: 2, total: 5, pages: 3 });
    for (const each of [first, next, last, beyond]) {
      expect(each.summary).toEqual(SUMMARY);
      expect(each.groupCounts).toEqual({ all: 5, open: 3, overdue: 1, paid: 1, credit: 1 });
    }
    // A part-paid invoice on a page without its credit note is still settled with it; the credit note names its invoice.
    expect(next.invoices.map((i) => [i.number, i.state, i.outstandingCents, i.rectifiesNumber])).toEqual([
      ["SOC-3", "partial", 16_780, null],
      ["SOC-R1", "credit", 0, "SOC-3"],
    ]);
    expect((await svc.listInvoices(s.ctx, {}, { page: 2, limit: 3 })).invoices.map((i) => [i.number, i.rectifiesNumber])).toEqual([
      ["SOC-R1", "SOC-3"],
      ["SOC-2", null],
    ]);
  });

  it("caps a huge limit and refuses a page that isn't one", async () => {
    const s = await many();
    expect((await svc.listInvoices(s.ctx, {}, { limit: 1_000_000 })).paging).toMatchObject({ limit: 200, total: 5 });
    expect((await svc.listPayments(s.ctx, {}, { limit: "99999" })).paging).toMatchObject({ limit: 200, total: 2 });
    for (const bad of [{ page: 0 }, { page: "abc" }, { limit: -5 }]) {
      await expect(svc.listInvoices(s.ctx, {}, bad)).rejects.toMatchObject({ code: "invalid_page", status: 400 });
      await expect(svc.listPayments(s.ctx, {}, bad)).rejects.toMatchObject({ code: "invalid_page", status: 400 });
    }
    await expect(svc.listInvoices(s.ctx, {}, { group: "pending" })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("finds an invoice by its order's number as shown, short or long: PED-007, PED-123, PED-1000", async () => {
    const s = await many();
    const [, soon] = s.ids;
    const kept = async (q: string) => idsOf(await svc.listInvoices(s.ctx, {}, { page: 1, q }));

    for (const [number, label] of [[7, "PED-007"], [123, "PED-123"], [1000, "PED-1000"]] as const) {
      await db.update(purchaseOrders).set({ number }).where(eq(purchaseOrders.id, s.subId));
      expect(await kept(label)).toEqual([soon]);
      expect((await svc.listInvoices(s.ctx, {}, { page: 1, q: label })).invoices.map((i) => orderLabel(i.orderNumber))).toEqual([label]);
    }
    // Number 1000 is not cut to "100", and takes no zero in front.
    expect(await kept("PED-100")).toEqual([soon]);
    expect(await kept("PED-0100")).toEqual([]);
    expect(await kept("PED-01000")).toEqual([]);
  });

  it("filters the list on the server by state, obra, supplier and text, never the summary", async () => {
    const s = await many();
    const [overdue, soon, partial, credit, paid] = s.ids;
    const list = (query: Record<string, unknown>) => svc.listInvoices(s.ctx, {}, { page: 1, ...query });
    const kept = async (query: Record<string, unknown>) => idsOf(await list(query));

    expect(await kept({ group: "open" })).toEqual([overdue, soon, partial]);
    expect(await kept({ group: "overdue" })).toEqual([overdue]);
    expect(await kept({ group: "paid" })).toEqual([paid]);
    expect(await kept({ group: "credit" })).toEqual([credit]);
    expect(await kept({ supplierId: s.subcontractorId })).toEqual([soon]);
    expect(await kept({ projectId: s.project.id })).toEqual(s.ids);
    expect(await kept({ projectId: s.gone.id })).toEqual([]);
    expect(await kept({ projectId: s.other.project.id })).toEqual([]);
    // Text: the invoice's number, its supplier, its order (PED-…, its description) or its obra.
    expect(await kept({ q: "soc-r" })).toEqual([credit]);
    expect(await kept({ q: "PED-001" })).toEqual([soon]);
    expect(await kept({ q: "liébana" })).toEqual([overdue, partial, credit, paid]);
    expect(await kept({ q: "steel frame" })).toEqual([soon]);
    expect(await kept({ q: s.project.ref })).toEqual(s.ids);
    expect(await kept({ q: "SOC-4" })).toEqual([]);
    expect(await kept({ q: "SOC-_" })).toEqual([]);

    const narrowed = await list({ supplierId: s.supplierId, group: "open", limit: 1 });
    expect(idsOf(narrowed)).toEqual([overdue]);
    expect(narrowed.paging).toEqual({ page: 1, limit: 1, total: 2, pages: 2 });
    // The counts follow the supplier and the text, not the state asked for.
    expect(narrowed.groupCounts).toEqual({ all: 4, open: 2, overdue: 1, paid: 1, credit: 1 });
    expect(narrowed.summary).toEqual(SUMMARY);
    // A project or a supplier given as the list's scope (the API's ?projectId, ?subcontractorId) narrows the summary too.
    const scoped = await svc.listInvoices(s.ctx, { subcontractorId: s.subcontractorId }, { page: 1 });
    expect(idsOf(scoped)).toEqual([soon]);
    expect(scoped.summary).toMatchObject({ outstandingCents: 46_550, outstandingInvoices: 1, outstandingSuppliers: 1, overdueInvoices: 0, paymentsThisMonth: 0 });
    expect(scoped.suppliers).toEqual([{ id: s.subcontractorId, name: "Montajes Steel Norte S.L." }]);
  });

  it("pages the payments made, with the month's total and the whole forecast on every page", async () => {
    const s = await many();
    const all = await svc.listPayments(s.ctx);
    expect(all.payments.map((p) => [p.invoiceNumber, p.amountCents])).toEqual([
      ["SOC-3", 5_000],
      ["SOC-2", 1_210],
    ]);
    expect(all.paging).toEqual({ page: 1, limit: 5000, total: 2, pages: 1 });

    const page = (n: number) => svc.listPayments(s.ctx, {}, { page: n, limit: 1 });
    const [first, last, beyond] = await Promise.all([page(1), page(2), page(3)]);
    expect(first.payments.map((p) => p.invoiceNumber)).toEqual(["SOC-3"]);
    expect(last.payments.map((p) => p.invoiceNumber)).toEqual(["SOC-2"]);
    expect(beyond.payments).toEqual([]);
    expect(first.paging).toEqual({ page: 1, limit: 1, total: 2, pages: 2 });
    for (const each of [first, last, beyond]) {
      expect(each.summary).toEqual({ monthCents: 6_210, monthPayments: 2 });
      expect(each.forecast).toEqual(all.forecast);
    }
    // Past due first, then by week: only what is owed, each settled with its credit note.
    expect(all.forecast[0]).toMatchObject({ from: null, totalCents: 12_100, invoices: [{ number: "SOC-1" }] });
    expect(all.forecast[1]).toMatchObject({ totalCents: 46_550, invoices: [{ number: "MSN-2026/112" }] });
    expect(all.forecast.flatMap((week) => week.invoices.map((i) => [i.number, i.outstandingCents]))).toEqual([
      ["SOC-1", 12_100],
      ["MSN-2026/112", 46_550],
      ["SOC-3", 16_780],
    ]);
    expect((await svc.listPayments(s.ctx, { subcontractorId: s.subcontractorId }, { page: 1 })).paging.total).toBe(0);
  });

  it("keeps tenants apart", async () => {
    const s = await many();
    const theirs = await svc.listInvoices(s.other.ctx, {}, { page: 1 });
    expect(theirs.invoices.map((i) => [i.number, i.baseCents])).toEqual([["SOC-1", 99_000]]);
    expect(theirs.summary).toMatchObject({ outstandingInvoices: 1, overdueInvoices: 1, paymentsThisMonth: 0 });
    expect(theirs.groupCounts).toEqual({ all: 1, open: 1, overdue: 1, paid: 0, credit: 0 });
    expect(idsOf(await svc.listInvoices(s.other.ctx, {}, { page: 1, supplierId: s.supplierId }))).toEqual([]);
    expect((await svc.listPayments(s.other.ctx, {}, { page: 1 })).payments).toEqual([]);
  });
});

describe("access", () => {
  it("lets viewers read but not write", async () => {
    const s = await setup("viewer");
    const { invoiceId } = await svc.createInvoice(s.admin, s.subId, invoice());
    expect((await svc.listInvoices(s.ctx)).invoices).toHaveLength(1);
    expect(await svc.getInvoice(s.ctx, invoiceId)).toMatchObject({ number: "MSN-2026/112" });
    await expect(svc.createInvoice(s.ctx, s.subId, invoice({ number: "X" }))).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.createPayment(s.ctx, invoiceId, { amountCents: 1 })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.updateInvoice(s.ctx, invoiceId, { number: "Y" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.deleteInvoice(s.ctx, invoiceId)).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.setOrderMilestones(s.ctx, s.subId, { milestones: [] })).rejects.toMatchObject({ code: "forbidden" });
    const { paymentId } = await svc.createPayment(s.admin, invoiceId, { amountCents: 100 });
    await expect(svc.deletePayment(s.ctx, paymentId)).rejects.toMatchObject({ code: "forbidden" });
    expect(await db.select().from(purchasePayments)).toMatchObject([{ deletedAt: null }]);
    expect(await db.select().from(purchaseInvoices)).toMatchObject([{ deletedAt: null }]);
  });

  it("keeps tenants apart", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice({ file: pdf() }));
    const { paymentId } = await svc.createPayment(s.ctx, invoiceId, { amountCents: 100, file: pdf() });
    const other = await createTestTenant();
    const stranger: Ctx = { tenantId: other.id, userId: (await createTestUser(other.id, { role: "admin" })).id, role: "admin" };

    expect((await svc.listInvoices(stranger)).invoices).toEqual([]);
    expect((await svc.listPayments(stranger)).payments).toEqual([]);
    expect(await svc.getPurchasingCounts(stranger)).toEqual({ requests: 0, orders: 0, invoices: 0, payments: 0, suppliers: 0, dueAttention: 0 });
    for (const attempt of [
      () => svc.getInvoice(stranger, invoiceId),
      () => svc.openInvoiceFile(stranger, invoiceId),
      () => svc.openPaymentFile(stranger, paymentId),
      () => svc.createInvoice(stranger, s.subId, invoice({ number: "Z" })),
      () => svc.createPayment(stranger, invoiceId, { amountCents: 1 }),
      () => svc.updateInvoice(stranger, invoiceId, { number: "Z" }),
      () => svc.deleteInvoice(stranger, invoiceId),
      () => svc.deletePayment(stranger, paymentId),
      () => svc.addInvoiceFile(stranger, invoiceId, { file: pdf() }),
      () => svc.setOrderMilestones(stranger, s.subId, { milestones: [] }),
      () => svc.getInvoiceForm(stranger, { orderId: s.subId }),
    ]) {
      await expect(attempt()).rejects.toMatchObject({ code: "not_found" });
    }
    // Another tenant deleted nothing.
    expect(await db.select().from(purchasePayments)).toMatchObject([{ deletedAt: null }]);
    expect(await db.select().from(purchaseInvoices)).toMatchObject([{ deletedAt: null }]);
  });
});

describe("seedPurchaseInvoices", () => {
  it("invoices the demo obra: a structure with milestones, paid orders, one past due and a credit note", async () => {
    const { seedObra, seedControl } = await import("../src/seed/seed-obra");
    const { seedSubcontractors } = await import("../src/seed/subcontractors");
    const { seedPurchasing } = await import("../src/seed/purchasing");
    const { seedPurchaseInvoices } = await import("../src/seed/purchase-invoices");
    const tenant = await createTestTenant();
    const admin: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" };
    const project = await createTestProject(tenant.id, {
      startDate: new Date("2026-03-10T00:00:00Z"),
      completionDate: new Date("2027-01-15T00:00:00Z"),
    });
    await seedObra(admin, project.id);
    await seedControl(admin, project.id);
    await seedSubcontractors(admin, project.id, { files: false });
    await seedPurchasing(admin, project.id);

    expect(await seedPurchaseInvoices(admin, project.id)).toBeGreaterThan(4);
    // Once only.
    expect(await seedPurchaseInvoices(admin, project.id)).toBe(0);

    const { invoices } = await svc.listInvoices(admin, { projectId: project.id });
    const states = invoices.map((i) => i.state);
    expect(states).toEqual(expect.arrayContaining(["overdue", "partial", "paid", "credit"]));
    const partial = invoices.find((i) => i.state === "partial")!;
    expect(partial).toMatchObject({ dueOn: "2026-10-22", milestoneConcept: "Entrega en obra", retentionBp: 500 });

    const view = await purchasingService.getProjectPurchaseLines(admin, project.id);
    expect(view.counts.paid).toBeGreaterThan(0);
    expect(view.counts.invoiced).toBeGreaterThan(0);
    expect(view.counts.to_contract).toBeGreaterThan(0);
    expect(view.dueAlerts.length).toBeGreaterThanOrEqual(2);
    const structure = view.chapters.find((c) => c.code === "03")!.lines.flatMap((l) => l.orders).find((o) => o.milestones.length > 0)!;
    expect(structure.milestones.map((m) => m.progress)).toEqual(["paid", "invoiced", "contracted"]);
    // The Obra tab still reads the same contracts.
    expect((await constructionService.getCosts(admin, project.id)).chapters.length).toBeGreaterThan(0);
  });
});

// ─── One rule, two languages ─────────────────────────────────────────────────
// An invoice's state and an order's late delivery are worked out twice: in SQL,
// where the lists filter, count and add up (`settledInvoices`, `isLate`), and
// in TypeScript for the rows shown (`settle` / `invoiceState` in purchase-calc,
// `lateDays` in control-calc). They must agree for every row.

describe("the SQL of the lists and the TypeScript rules", () => {
  const TODAY = "2026-10-19";
  const HORIZON = addDays(TODAY, DUE_SOON_DAYS);

  /**
   * Invoices in every state there is, by number. On the material order (21 %
   * VAT: 5.000 € of base is 6.050 € to pay) and on the subcontract (reverse
   * charge, 5 % retention: 10.000 € of base is 9.500 € to pay, 500 € held).
   */
  async function variedInvoices() {
    const s = await setup("viewer");
    const { admin } = s;
    const made = new Map<string, string>();
    const add = async (orderId: string, number: string, dueOn: string, overrides: Record<string, unknown> = {}) => {
      const { invoiceId } = await svc.createInvoice(admin, orderId, invoice({ number, baseCents: 5_000, dueOn, ...overrides }));
      made.set(number, invoiceId);
      return invoiceId;
    };
    const pay = (invoiceId: string, amountCents: number, paidOn = "2026-10-02") => svc.createPayment(admin, invoiceId, { amountCents, paidOn });
    const credit = (invoiceId: string, number: string, baseCents: number) =>
      add(s.materialId, number, "2026-11-30", { kind: "credit_note", rectifiesId: invoiceId, issuedOn: "2026-10-01", baseCents, dueOn: undefined });
    const material = (number: string, dueOn: string) => add(s.materialId, number, dueOn);
    const retained = (number: string, dueOn: string) => add(s.subId, number, dueOn, { baseCents: 10_000 });

    // Unpaid: due later, today, yesterday, on the last day of "due soon" and the day after.
    await material("UNPAID-LATER", "2026-11-30");
    await material("UNPAID-TODAY", TODAY);
    await material("UNPAID-YESTERDAY", addDays(TODAY, -1));
    await material("UNPAID-HORIZON", HORIZON);
    await material("UNPAID-PAST-HORIZON", addDays(HORIZON, 1));
    // Part paid: not yet due, and past due.
    await pay(await material("PART-LATER", "2026-11-10"), 1_000);
    await pay(await material("PART-PAST", "2026-10-01"), 1_000);
    // Paid: to the cent, though past due.
    await pay(await material("PAID", "2026-10-01"), 6_050);
    // A payment deleted: the invoice it had settled is owed again; one of two deleted leaves it part paid, past due.
    const undone = await pay(await material("PAYMENT-DELETED", "2026-10-22"), 6_050);
    await svc.deletePayment(admin, undone.paymentId);
    const twice = await material("ONE-PAYMENT-DELETED", "2026-10-10");
    await pay(twice, 3_000);
    await svc.deletePayment(admin, (await pay(twice, 3_050)).paymentId);
    // Credit notes: part of the invoice, all of it, one deleted, and one with a payment for the rest or less.
    await credit(await material("CREDITED-PART", "2026-11-15"), "CN-PART", -2_000);
    await credit(await material("CREDITED-WHOLE", "2026-10-05"), "CN-WHOLE", -5_000);
    await svc.deleteInvoice(admin, await credit(await material("CREDIT-DELETED", "2026-10-05"), "CN-DELETED", -5_000));
    const settledWithCredit = await material("CREDITED-AND-PAID", "2026-10-22");
    await credit(settledWithCredit, "CN-AND-PAID", -1_000);
    await pay(settledWithCredit, 4_840);
    const owedWithCredit = await material("CREDITED-PART-PAID", "2026-10-24");
    await credit(owedWithCredit, "CN-PART-PAID", -1_000);
    await pay(owedWithCredit, 1_000);
    // Without a due date (older rows): never past due, never due soon.
    const undated = [await material("NO-DUE-DATE", "2026-11-30"), await material("NO-DUE-DATE-PART", "2026-11-30")];
    await pay(undated[1]!, 500);
    for (const id of undated) await db.update(purchaseInvoices).set({ dueOn: null }).where(eq(purchaseInvoices.id, id));
    // An invoice deleted: in neither.
    await svc.deleteInvoice(admin, await material("DELETED", "2026-10-01"));
    // With a retention: paid but for what is held, paid with the retention released (more than was due), and short of it.
    await pay(await retained("RETENTION-HELD", "2026-10-22"), 9_500);
    const released = await retained("RETENTION-RELEASED", "2026-10-22");
    await pay(released, 9_500);
    await pay(released, 500, "2026-10-12");
    await pay(await retained("RETENTION-SHORT", "2026-10-01"), 9_000);

    const numberOf = new Map([...made].map(([number, id]) => [id, number]));
    return { ...s, made, numberOf };
  }

  it("agree on every invoice's state and on what it owes", async () => {
    const s = await variedInvoices();
    const shown = (await svc.listInvoices(s.ctx)).invoices;
    const inSql = await db.execute<{ id: string; kind: string; state: string; outstanding: string }>(
      sql`select id, kind, state, outstanding from (${svc.settledInvoices(s.tenant.id, {}, TODAY)}) st`,
    );

    // The same invoices, each in the same state, owing the same.
    const byNumber = <R extends { id: string }, T>(rows: R[], value: (row: R) => T) =>
      Object.fromEntries(rows.map((row) => [s.numberOf.get(row.id)!, value(row)] as const));
    const statesInSql = byNumber([...inSql], (row) => row.state);
    const statesShown = byNumber(shown, (row) => row.state);
    expect(inSql).toHaveLength(shown.length);
    expect(statesInSql).toEqual(statesShown);
    expect(byNumber(inSql.filter((row) => row.kind === "invoice"), (row) => Number(row.outstanding))).toEqual(
      byNumber(shown.filter((row) => row.kind === "invoice"), (row) => row.outstandingCents),
    );

    // And the set is what it was built to be: every state, each case where it belongs.
    expect(statesShown).toEqual({
      "CN-AND-PAID": "credit",
      "CN-PART": "credit",
      "CN-PART-PAID": "credit",
      "CN-WHOLE": "credit",
      "CREDIT-DELETED": "overdue",
      "CREDITED-AND-PAID": "paid",
      "CREDITED-PART": "pending",
      "CREDITED-PART-PAID": "partial",
      "CREDITED-WHOLE": "paid",
      "NO-DUE-DATE": "pending",
      "NO-DUE-DATE-PART": "partial",
      "ONE-PAYMENT-DELETED": "overdue",
      PAID: "paid",
      "PART-LATER": "partial",
      "PART-PAST": "overdue",
      "PAYMENT-DELETED": "pending",
      "RETENTION-HELD": "paid",
      "RETENTION-RELEASED": "paid",
      "RETENTION-SHORT": "overdue",
      "UNPAID-HORIZON": "pending",
      "UNPAID-LATER": "pending",
      "UNPAID-PAST-HORIZON": "pending",
      "UNPAID-TODAY": "pending",
      "UNPAID-YESTERDAY": "overdue",
    });
    expect(shown.find((i) => i.number === "RETENTION-RELEASED")).toMatchObject({ outstandingCents: -500, retainedCents: 0 });
    expect(shown.find((i) => i.number === "RETENTION-HELD")).toMatchObject({ outstandingCents: 0, retainedCents: 500 });
  });

  it("agree on what each filter keeps, every count and every total", async () => {
    const s = await variedInvoices();
    const all = await svc.listInvoices(s.ctx);
    const shown = all.invoices;
    const numbers = (list: { number: string }[]) => list.map((i) => i.number).sort();
    // The lists' groups, as TypeScript has them.
    const inGroup: Record<(typeof PURCHASE_INVOICE_GROUPS)[number], (i: (typeof shown)[number]) => boolean> = {
      open: (i) => isOwed(i.state),
      overdue: (i) => i.state === "overdue",
      paid: (i) => i.state === "paid",
      credit: (i) => i.state === "credit",
    };

    for (const group of PURCHASE_INVOICE_GROUPS) {
      const kept = await svc.listInvoices(s.ctx, {}, { page: 1, limit: 200, group });
      expect(numbers(kept.invoices), group).toEqual(numbers(shown.filter(inGroup[group])));
      expect(kept.groupCounts[group], group).toBe(shown.filter(inGroup[group]).length);
      expect(kept.invoices.every(inGroup[group]), group).toBe(true);
    }
    expect(all.groupCounts.all).toBe(shown.length);

    const owed = shown.filter((i) => isOwed(i.state));
    const overdue = shown.filter((i) => i.state === "overdue");
    const dueSoon = shown.filter((i) => isDueSoon(i, TODAY));
    expect(all.summary).toMatchObject({
      outstandingCents: svc.sumOwed(owed),
      outstandingInvoices: owed.length,
      outstandingSuppliers: new Set(owed.map((i) => i.subcontractorId)).size,
      overdueCents: svc.sumOwed(overdue),
      overdueInvoices: overdue.length,
      dueSoonCents: svc.sumOwed(dueSoon),
      dueSoonInvoices: dueSoon.length,
    });
    expect(numbers(dueSoon)).toEqual(["CREDITED-PART-PAID", "PAYMENT-DELETED", "UNPAID-HORIZON", "UNPAID-TODAY"]);

    // The rail's badge: owed and due by the horizon, past due included; counted without settling the rest.
    const needsPaying = shown.filter((i) => isOwed(i.state) && i.dueOn !== null && i.dueOn <= HORIZON);
    expect(await svc.getPurchasingCounts(s.ctx)).toMatchObject({ invoices: shown.length, dueAttention: needsPaying.length });
    expect(needsPaying.length).toBe(dueSoon.length + overdue.length);
    // The payments forecast lists exactly what is owed and falls due within its weeks, past due included.
    const forecast = (await svc.listPayments(s.ctx)).forecast.flatMap((week) => week.invoices);
    const lastDay = addDays(TODAY, PAYMENT_FORECAST_DAYS);
    expect(numbers(forecast)).toEqual(numbers(owed.filter((i) => i.dueOn !== null && i.dueOn <= lastDay)));
    expect(numbers(forecast)).not.toContain("UNPAID-LATER");
  });

  it("agree on which orders are a late delivery", async () => {
    const s = await setup("viewer");
    const { admin } = s;
    const yesterday = addDays(TODAY, -1);
    const order = async (description: string, expectedOn: string | null, overrides: Record<string, unknown> = {}) => {
      const { orderId } = await purchasingService.createPurchase(admin, s.project.id, {
        kind: "material",
        subcontractorId: s.supplierId,
        description,
        status: "ordered",
        orderedOn: "2026-09-01",
        ...(expectedOn ? { expectedOn } : {}),
        lines: [{ lineageId: s.lineage("01"), amountCents: 1_000 }],
        ...overrides,
      });
      return orderId;
    };
    const move = (orderId: string, status: string) => purchasingService.setPurchaseStatus(admin, orderId, { status, date: "2026-10-01" });

    await order("ordered, expected yesterday", yesterday);
    await order("ordered, expected today", TODAY);
    await order("ordered, expected later", "2026-11-30");
    await order("ordered, no expected day", null);
    await order("not sent, expected yesterday", yesterday, { status: "pending", orderedOn: undefined });
    await move(await order("confirmed, expected yesterday", yesterday), "confirmed");
    await move(await order("in transit, expected long ago", "2026-09-15"), "in_transit");
    await move(await order("delivered, expected yesterday", yesterday), "delivered");
    await move(await order("cancelled, expected yesterday", yesterday), "cancelled");
    // A subcontract is never a delivery, whatever day it carries (the setup's two orders have none).
    await db.update(purchaseOrders).set({ expectedOn: yesterday }).where(eq(purchaseOrders.id, s.subId));

    const all = await purchasingService.listPurchases(s.ctx);
    const late = await purchasingService.listPurchases(s.ctx, { page: 1, limit: 200, late: "1" });
    const described = (orders: { description: string }[]) => orders.map((o) => o.description).sort();

    // TypeScript's rule on each row shown, and SQL's filter and count, name the same orders.
    const lateShown = all.orders.filter((o) => o.lateDays !== null);
    expect(all.orders.map((o) => lateDays(o, TODAY))).toEqual(all.orders.map((o) => o.lateDays));
    expect(described(late.orders)).toEqual(described(lateShown));
    expect(late.paging.total).toBe(lateShown.length);
    expect(all.summary.lateDeliveries).toBe(lateShown.length);
    expect(described(lateShown)).toEqual(["confirmed, expected yesterday", "in transit, expected long ago", "ordered, expected yesterday"]);
    expect(all.orders).toHaveLength(11);
  });
});
