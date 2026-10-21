import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import {
  budgetService,
  constructionService,
  isValidCif,
  purchaseInvoicesService as svc,
  purchasingService,
  subcontractorsService,
  type Ctx,
} from "../src";
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
  await budgetService.acceptRevision(admin, project.id, revisionId);
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

  it("keeps the proof, and a payment recorded by mistake can go", async () => {
    const s = await setup();
    const { invoiceId } = await svc.createInvoice(s.ctx, s.subId, invoice());
    const { paymentId } = await svc.createPayment(s.ctx, invoiceId, { amountCents: 1_000, file: pdf("%PDF-1.7 justificante", "Justificante.pdf") });
    expect(await svc.openPaymentFile(s.ctx, paymentId)).toMatchObject({ filename: "Justificante.pdf" });
    const stored = files.size;

    await svc.deletePayment(s.ctx, paymentId);
    expect(files.size).toBe(stored - 1);
    expect(await svc.getInvoice(s.ctx, invoiceId)).toMatchObject({ paidCents: 0, state: "pending" });
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

  it("deletes an invoice nothing was paid on and no credit note rectifies, with its PDFs", async () => {
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
    expect(files.size).toBe(0);
    await expect(svc.getInvoice(s.ctx, invoiceId)).rejects.toMatchObject({ code: "not_found" });
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

  it("warns when the order's amount moves away from its schedule", async () => {
    const s = await setup();
    await withMilestones(s);
    await purchasingService.updatePurchase(s.admin, s.subId, { lines: [{ lineageId: s.lineage("03"), amountCents: 100_000 }] });
    const order = await purchasingService.getPurchase(s.ctx, s.subId);
    expect(order.milestones.reduce((sum, m) => sum + m.amountCents, 0) - order.amountCents).toBe(-2_000);
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
