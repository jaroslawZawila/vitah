import { purchaseInvoicesService, purchasingService, subcontractorsService } from "@repo/core";
import {
  db,
  eq,
  obraIssues,
  purchaseInvoices,
  purchaseOrderAmendments,
  purchaseOrders,
  purchasePayments,
  purchaseRequests,
} from "@repo/db";
import { createTestUser } from "@repo/db/testing";
import { seededObraProject } from "./api";

// What the tests of the six creates that take an idempotency key share (the
// /api/v1 routes and the server actions): an obra to create on, a body for
// each create, and how many records of each kind the tenant has.

export const CREATES = ["order", "request", "issue", "invoice", "payment", "amendment"] as const;
export type Create = (typeof CREATES)[number];

/** The seeded obra with a material order of 3.000 € placed on chapter 06's first line and an invoice of 1.000 € on it. */
export async function obraToCreateOn() {
  const { tenant, project } = await seededObraProject();
  const staff = await createTestUser(tenant.id, { role: "admin" });
  const admin = { tenantId: tenant.id, userId: staff.id, role: "admin" as const };
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
  const lineageId = form.chapters.find((c) => c.code === "06")!.lines[0]!.lineageId;
  const { orderId } = await purchasingService.createPurchase(admin, project.id, {
    kind: "material",
    subcontractorId: supplierId,
    description: "Piedra",
    status: "ordered",
    lines: [{ lineageId, amountCents: 300_000 }],
  });
  const { invoiceId } = await purchaseInvoicesService.createInvoice(admin, orderId, { number: "PL-100", issuedOn: "2026-10-01", baseCents: 100_000 });
  return { tenant, project, admin, supplierId, lineageId, orderId, invoiceId };
}

export type Obra = Awaited<ReturnType<typeof obraToCreateOn>>;

/** A valid body for each create; `n` tells one submission from the next (a new number, another amount). */
export const createBody: Record<Create, (obra: Obra, n: number) => Record<string, unknown>> = {
  order: (obra, n) => ({
    kind: "material",
    subcontractorId: obra.supplierId,
    description: `Piedra, remesa ${n}`,
    status: "ordered",
    lines: [{ lineageId: obra.lineageId, amountCents: 10_000 }],
  }),
  request: (obra, n) => ({ kind: "material", description: `Más piedra ${n}`, lines: [{ lineageId: obra.lineageId, amountCents: 20_000 }] }),
  issue: (_obra, n) => ({ kind: "issue", occurredOn: "2026-10-08", chapterCode: "06", description: `Retraso de la piedra ${n}`, party: "other" }),
  invoice: (_obra, n) => ({ number: `PL-20${n}`, issuedOn: "2026-10-05", baseCents: 50_000 }),
  payment: (_obra, n) => ({ amountCents: 10_000 + n, reference: `TRF-${n}` }),
  amendment: (obra, n) => ({ concept: `Más metros ${n}`, lines: [{ lineageId: obra.lineageId, amountCents: 310_000 + 1_000 * n }] }),
};

/** How many records of each kind the tenant has. */
export async function countRecords(tenantId: string): Promise<Record<Create, number>> {
  const count = async (table: typeof purchaseOrders | typeof purchaseRequests | typeof obraIssues | typeof purchaseInvoices | typeof purchasePayments | typeof purchaseOrderAmendments) =>
    (await db.select({ id: table.id }).from(table).where(eq(table.tenantId, tenantId))).length;
  return {
    order: await count(purchaseOrders),
    request: await count(purchaseRequests),
    issue: await count(obraIssues),
    invoice: await count(purchaseInvoices),
    payment: await count(purchasePayments),
    amendment: await count(purchaseOrderAmendments),
  };
}
