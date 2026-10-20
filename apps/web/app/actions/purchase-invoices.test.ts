import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { purchasingService, subcontractorsService } from "@repo/core";
import { files } from "@repo/core/testing";
import { seedObra } from "@repo/core/seed";
import { signInAs } from "../../test/session";
import { getProjectPurchaseLines } from "./purchasing";
import {
  addInvoiceFileAction,
  createInvoiceAction,
  createPaymentAction,
  deleteInvoiceAction,
  deletePaymentAction,
  getInvoice,
  getInvoiceForm,
  getInvoices,
  getPayments,
  getPurchasingCounts,
  setOrderMilestonesAction,
  updateInvoiceAction,
} from "./purchase-invoices";

// The service is covered in packages/core; these tests cover the adapter:
// session → core → `{ error }` / revalidation.

vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

const pdf = (content = "%PDF-1.7 factura") => new File([content], "factura.pdf", { type: "application/pdf" });

/** A form's fields as JSON in `data`, and a file. */
function formOf(data: Record<string, unknown>, file?: File) {
  const form = new FormData();
  form.set("data", JSON.stringify(data));
  if (file) form.set("file", file);
  return form;
}

/** The seeded obra, a material supplier and an order of 3.000 € placed on chapter 06's first line. */
async function setup(role: "admin" | "manager" | "viewer" = "manager") {
  const tenant = await createTestTenant();
  const staff = await createTestUser(tenant.id, { role: "admin" });
  const user = await createTestUser(tenant.id, { role });
  const project = await createTestProject(tenant.id);
  const admin = { tenantId: tenant.id, userId: staff.id, role: "admin" as const };
  await seedObra(admin, project.id);
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
  signInAs({ tenantId: tenant.id, userId: user.id, role });
  return { tenant, project, orderId };
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.mocked(revalidatePath).mockClear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

describe("invoice actions", () => {
  it("register, pay, version, edit and delete an invoice, refreshing the project and the dashboard", async () => {
    const { orderId } = await setup();

    const created = await createInvoiceAction(orderId, formOf({ number: "PL-1", issuedOn: "2026-10-01", baseCents: 300_000 }, pdf()));
    expect(created).toEqual({ success: true, invoiceId: expect.any(String) });
    const invoiceId = created!.invoiceId!;
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");

    const proof = formOf({ amountCents: 100_000, paidOn: "2026-10-15", method: "confirming" }, pdf("%PDF-1.7 justificante"));
    expect(await createPaymentAction(invoiceId, proof)).toEqual({ success: true });
    const version = new FormData();
    version.set("file", pdf("%PDF-1.7 v2"));
    version.set("note", "Corregida");
    expect(await addInvoiceFileAction(invoiceId, version)).toEqual({ success: true });
    expect(await updateInvoiceAction(invoiceId, { notes: "Por correo" })).toEqual({ success: true });

    const { invoice } = (await getInvoice(invoiceId))!;
    expect(invoice).toMatchObject({ number: "PL-1", state: "partial", paidCents: 100_000, notes: "Por correo", files: [{ version: 2 }, { version: 1 }] });
    expect(invoice.payments[0]).toMatchObject({ method: "confirming", file: { name: "factura.pdf" } });

    expect(await deleteInvoiceAction(invoiceId)).toEqual({ error: "has_payments" });
    expect(await deletePaymentAction(invoice.payments[0]!.id)).toEqual({ success: true });
    expect(await deleteInvoiceAction(invoiceId)).toEqual({ success: true });
  });

  it("set an order's schedule and read the lists, the form, the counts and the obra by line", async () => {
    const { project, orderId } = await setup();
    expect(
      await setOrderMilestonesAction(orderId, [
        { concept: "Pedido", amountCents: 100_000 },
        { concept: "Entrega", amountCents: 200_000 },
      ]),
    ).toEqual({ success: true });
    const { form } = (await getInvoiceForm({ orderId }))!;
    expect(form.order!.milestones.map((m) => m.concept)).toEqual(["Pedido", "Entrega"]);
    await createInvoiceAction(orderId, formOf({ number: "PL-1", issuedOn: "2026-09-01", baseCents: 100_000, milestoneId: form.order!.milestones[0]!.id }));

    expect((await getInvoices())!.invoices.summary).toMatchObject({ overdueInvoices: 1 });
    expect((await getPayments())!.payments.forecast[0]!.invoices).toHaveLength(1);
    expect(await getPurchasingCounts()).toEqual({ requests: 0, orders: 1, invoices: 1, payments: 0, dueAttention: 1 });
    expect((await getProjectPurchaseLines(project.id))!.lines.counts.invoiced).toBe(1);
  });

  it("return the service's errors, refuse viewers' writes and read nothing for another tenant", async () => {
    const { orderId } = await setup("viewer");
    expect(await createInvoiceAction(orderId, formOf({ number: "X", issuedOn: "2026-10-01", baseCents: 1 }))).toEqual({ error: "forbidden" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await getInvoices()).toMatchObject({ canManage: false });

    await setup();
    expect(await createInvoiceAction(orderId, formOf({ number: "X", issuedOn: "2026-10-01", baseCents: 1 }))).toEqual({ error: "not_found" });
    expect((await getInvoices())!.invoices.invoices).toEqual([]);
    expect(await getInvoice("nope")).toBeNull();
    signInAs(null);
    expect(await getPurchasingCounts()).toBeNull();
  });
});
