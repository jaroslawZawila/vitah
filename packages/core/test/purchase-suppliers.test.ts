import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import {
  budgetService,
  purchaseInvoicesService,
  purchaseSuppliersService as svc,
  purchasingService,
  subcontractorsService,
  type Ctx,
} from "../src";
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

const invoice = (overrides: Record<string, unknown> = {}) => ({
  number: "MSN-2026/112",
  issuedOn: "2026-09-22",
  baseCents: 49_000,
  ...overrides,
});

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

/**
 * The subcontractor invoiced half its 980 € (5 % retention, due in three
 * days); the material supplier invoiced all its 1.450 € (21 % VAT) in August,
 * paid 500 € and owes the rest past due; a third company has no orders.
 */
async function withInvoices(s: Awaited<ReturnType<typeof setup>>) {
  await purchaseInvoicesService.createInvoice(s.admin, s.subId, invoice());
  const { invoiceId } = await purchaseInvoicesService.createInvoice(s.admin, s.materialId, {
    number: "PL-0815",
    issuedOn: "2026-08-01",
    baseCents: 145_000,
  });
  await purchaseInvoicesService.createPayment(s.admin, invoiceId, { amountCents: 50_000, paidOn: "2026-09-01" });
  await purchasingService.createPurchase(s.admin, s.project.id, {
    kind: "material",
    subcontractorId: s.supplierId,
    description: "Sin enviar",
    lines: [{ lineageId: s.lineage("02"), amountCents: 10_000, closesLine: false }],
  });
  await subcontractorsService.createSubcontractor(s.admin, company({ legalName: "Aislamientos Cantábrico S.L.", taxId: "B39811831", suppliesOnly: true }));
}

describe("Compras › Proveedores", () => {
  it("lists every company with what it was ordered, invoiced, paid and is owed; those owed most first", async () => {
    const s = await setup();
    await withInvoices(s);
    const { suppliers, summary } = await svc.listSuppliers(s.ctx);
    expect(suppliers.map((x) => x.legalName)).toEqual(["Piedra de Liébana S.L.", "Montajes Steel Norte S.L.", "Aislamientos Cantábrico S.L."]);
    expect(suppliers[0]).toEqual({
      id: s.supplierId,
      legalName: "Piedra de Liébana S.L.",
      kind: "company",
      suppliesOnly: true,
      caeStatus: "apta",
      orders: 2,
      projects: 1,
      contractedCents: 145_000,
      invoicedCents: 145_000,
      // Without VAT, as invoiced: the 500 € paid cover 413,22 € of base (21 % VAT).
      paidCents: 41_322,
      outstandingCents: 125_450,
      overdueCents: 125_450,
      retainedCents: 0,
      // The pending order's: the day it was created (the database's clock).
      lastOrderOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    });
    expect(suppliers[1]).toMatchObject({
      suppliesOnly: false,
      orders: 1,
      contractedCents: 98_000,
      invoicedCents: 49_000,
      paidCents: 0,
      outstandingCents: 46_550,
      overdueCents: 0,
      retainedCents: 2_450,
      lastOrderOn: "2026-06-18",
    });
    expect(suppliers[2]).toMatchObject({ orders: 0, contractedCents: 0, outstandingCents: 0, lastOrderOn: null });
    expect(summary).toEqual({
      active: 2,
      contractedCents: 243_000,
      outstandingCents: 172_000,
      overdueCents: 125_450,
      overdueSuppliers: 1,
      retainedCents: 2_450,
    });
    expect((await purchaseInvoicesService.getPurchasingCounts(s.ctx)).suppliers).toBe(3);
  });

  it("shows one supplier's orders, invoices (owed first) and payments", async () => {
    const s = await setup("viewer");
    await withInvoices(s);
    const view = await svc.getSupplierPurchasing(s.ctx, s.supplierId);
    expect(view.supplier).toMatchObject({ legalName: "Piedra de Liébana S.L.", outstandingCents: 125_450 });
    expect(view.orders.map((o) => [o.description, o.status])).toEqual([
      ["Sin enviar", "pending"],
      ["Hormigón y lámina", "ordered"],
    ]);
    expect(view.invoices.map((i) => [i.number, i.state])).toEqual([["PL-0815", "overdue"]]);
    expect(view.payments.map((p) => [p.invoiceNumber, p.amountCents])).toEqual([["PL-0815", 50_000]]);
    expect(view.today).toBe("2026-10-19");
  });

  it("stays within its tenant", async () => {
    const s = await setup();
    await withInvoices(s);
    const other = await setup();
    await expect(svc.getSupplierPurchasing(other.ctx, s.supplierId)).rejects.toMatchObject({ code: "not_found" });
    const theirs = await svc.listSuppliers(other.ctx);
    expect(theirs.suppliers.map((x) => x.id).sort()).toEqual([other.subcontractorId, other.supplierId].sort());
    expect(theirs.summary.outstandingCents).toBe(0);
  });
});
