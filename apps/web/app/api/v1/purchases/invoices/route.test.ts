import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { purchasingService, subcontractorsService } from "@repo/core";
import { files } from "@repo/core/testing";
import { apiRequest, routeParams, seededObraProject, staffToken } from "../../../../../test/api";
import { GET as list } from "./route";
import { POST as createOn } from "../[orderId]/invoices/route";
import { GET as getForm } from "./form/route";
import { DELETE as remove, GET as getOne, PATCH as update } from "./[invoiceId]/route";
import { GET as getFile, POST as addFile } from "./[invoiceId]/file/route";
import { POST as pay } from "./[invoiceId]/payments/route";
import { GET as listPayments } from "../payments/route";
import { DELETE as deletePayment } from "../payments/[paymentId]/route";
import { GET as paymentFile } from "../payments/[paymentId]/file/route";
import { GET as counts } from "../counts/route";
import { PUT as setMilestones } from "../[orderId]/milestones/route";
import { GET as lines } from "../../projects/[id]/purchases/lines/route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-19T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

const json = (body: unknown, method = "POST") => ({ method, body });
const pdf = (content: string) => new File([content], "doc.pdf", { type: "application/pdf" });

/** A multipart body: the fields as JSON in `data`, and a file. */
function multipart(data: Record<string, unknown>, file: File) {
  const form = new FormData();
  form.set("data", JSON.stringify(data));
  form.set("file", file);
  return { method: "POST", body: form };
}

/** The seeded obra with a material order of 3.000 € placed on chapter 06's first line. */
async function setup() {
  const { tenant, project } = await seededObraProject();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" as const };
  const { id: supplierId } = await subcontractorsService.createSubcontractor(ctx, {
    kind: "company",
    legalName: "Piedra de Liébana S.L.",
    taxId: "B39654322",
    address: "Barrio La Serna 7",
    postalCode: "39570",
    city: "Potes",
    suppliesOnly: true,
  });
  const form = await purchasingService.getPurchaseForm(ctx, project.id);
  const lineageId = form.chapters.find((c) => c.code === "06")!.lines[0]!.lineageId;
  const { orderId } = await purchasingService.createPurchase(ctx, project.id, {
    kind: "material",
    subcontractorId: supplierId,
    description: "Piedra",
    status: "ordered",
    lines: [{ lineageId, amountCents: 300_000 }],
  });
  return { tenant, project, orderId };
}

describe("/api/v1 supplier invoices", () => {
  it("registers an invoice with its PDF, pays it, versions it and lists it", async () => {
    const { tenant, project, orderId } = await setup();
    const { token } = await staffToken(tenant.id);

    const form = await (await getForm(apiRequest(token, { query: `?orderId=${orderId}` }))).json();
    expect(form.order).toMatchObject({ amountCents: 300_000, terms: { vatKind: "vat21", paymentDays: 30 } });

    const created = await createOn(apiRequest(token, multipart({ number: "PL-1", issuedOn: "2026-10-01", baseCents: 300_000 }, pdf("%PDF-1.7 v1"))), routeParams({ orderId }));
    expect(created.status).toBe(201);
    const { invoiceId } = await created.json();
    const missing = await createOn(apiRequest(token, json({ number: "PL-2" })), routeParams({ orderId }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "invalid_date" });
    const duplicate = await createOn(apiRequest(token, json({ number: "PL-1", issuedOn: "2026-10-01", baseCents: 1 })), routeParams({ orderId }));
    expect(duplicate.status).toBe(409);

    const paid = await pay(apiRequest(token, json({ amountCents: 100_000, paidOn: "2026-10-15" })), routeParams({ invoiceId }));
    expect(paid.status).toBe(201);
    const withProof = await pay(apiRequest(token, multipart({ amountCents: 1_000 }, pdf("%PDF-1.7 justificante"))), routeParams({ invoiceId }));
    const { paymentId } = await withProof.json();
    expect(await (await paymentFile(apiRequest(token), routeParams({ paymentId }))).text()).toBe("%PDF-1.7 justificante");
    const tooMuch = await pay(apiRequest(token, json({ amountCents: 400_000 })), routeParams({ invoiceId }));
    expect(await tooMuch.json()).toEqual({ error: "exceeds_amount" });

    const version = new FormData();
    version.set("file", pdf("%PDF-1.7 v2"));
    version.set("note", "Corregida");
    expect(await (await addFile(apiRequest(token, { method: "POST", body: version }), routeParams({ invoiceId }))).json()).toEqual({ invoiceId, version: 2 });
    expect(await (await getFile(apiRequest(token), routeParams({ invoiceId }))).text()).toBe("%PDF-1.7 v2");

    expect(await (await update(apiRequest(token, json({ notes: "Por correo" }, "PATCH")), routeParams({ invoiceId }))).json()).toEqual({ invoiceId });
    const detail = await (await getOne(apiRequest(token), routeParams({ invoiceId }))).json();
    expect(detail).toMatchObject({ number: "PL-1", state: "partial", paidCents: 101_000, notes: "Por correo", vatCents: 63_000 });

    const all = await (await list(apiRequest(token, { query: `?projectId=${project.id}` }))).json();
    expect(all.invoices.map((i: { id: string }) => i.id)).toEqual([invoiceId]);
    const payments = await (await listPayments(apiRequest(token))).json();
    expect(payments.payments).toHaveLength(2);
    expect(await (await counts(apiRequest(token))).json()).toEqual({ requests: 0, orders: 1, invoices: 1, payments: 2, suppliers: 1, dueAttention: 0 });
    const byLine = await (await lines(apiRequest(token), routeParams({ id: project.id }))).json();
    expect(byLine.summary).toMatchObject({ invoicedCents: 300_000, invoices: 1 });

    expect((await remove(apiRequest(token, { method: "DELETE" }), routeParams({ invoiceId }))).status).toBe(409);
    expect(await (await deletePayment(apiRequest(token, { method: "DELETE" }), routeParams({ paymentId }))).json()).toEqual({ paymentId });
  });

  it("sets an order's payment schedule", async () => {
    const { tenant, orderId } = await setup();
    const { token } = await staffToken(tenant.id);
    const body = { milestones: [{ concept: "Pedido", amountCents: 100_000 }, { concept: "Entrega", amountCents: 200_000 }] };
    expect(await (await setMilestones(apiRequest(token, json(body, "PUT")), routeParams({ orderId }))).json()).toEqual({ orderId });
    const wrong = await setMilestones(apiRequest(token, json({ milestones: [{ concept: "Todo", amountCents: 1 }] }, "PUT")), routeParams({ orderId }));
    expect(await wrong.json()).toEqual({ error: "milestones_mismatch" });
  });

  it("needs a token, lets viewers only read, and keeps tenants apart", async () => {
    const { tenant, orderId } = await setup();
    expect((await list(apiRequest(null))).status).toBe(401);

    const viewer = await staffToken(tenant.id, "viewer");
    const denied = await createOn(apiRequest(viewer.token, json({ number: "X", issuedOn: "2026-10-01", baseCents: 1 })), routeParams({ orderId }));
    expect(denied.status).toBe(403);
    expect((await list(apiRequest(viewer.token))).status).toBe(200);

    const manager = await staffToken(tenant.id);
    const { invoiceId } = await (await createOn(apiRequest(manager.token, json({ number: "X", issuedOn: "2026-10-01", baseCents: 1 })), routeParams({ orderId }))).json();

    const other = await createTestTenant();
    const { token } = await staffToken(other.id);
    expect(await (await getOne(apiRequest(token), routeParams({ invoiceId }))).json()).toEqual({ error: "not_found" });
    expect((await pay(apiRequest(token, json({ amountCents: 1 })), routeParams({ invoiceId }))).status).toBe(404);
    expect((await list(apiRequest(token))).status).toBe(200);
    expect((await (await list(apiRequest(token))).json()).invoices).toEqual([]);
  });
});
