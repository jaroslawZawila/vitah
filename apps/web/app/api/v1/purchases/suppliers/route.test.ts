import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { purchaseInvoicesService, purchasingService, subcontractorsService } from "@repo/core";
import { files } from "@repo/core/testing";
import { apiRequest, routeParams, seededObraProject, staffToken } from "../../../../../test/api";
import { GET as list } from "./route";
import { GET as getOne } from "./[subcontractorId]/route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

describe("/api/v1/purchases/suppliers", () => {
  it("lists the suppliers with their figures, and one supplier's orders, invoices and payments", async () => {
    const { tenant, project } = await seededObraProject();
    const ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" as const };
    const { id } = await subcontractorsService.createSubcontractor(ctx, {
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
      subcontractorId: id,
      description: "Piedra",
      status: "ordered",
      orderedOn: "2026-09-01",
      lines: [{ lineageId, amountCents: 100_000 }],
    });
    const { invoiceId } = await purchaseInvoicesService.createInvoice(ctx, orderId, { number: "PL-1", issuedOn: "2026-09-02", baseCents: 100_000 });
    await purchaseInvoicesService.createPayment(ctx, invoiceId, { amountCents: 21_000, paidOn: "2026-09-10" });
    const { token } = await staffToken(tenant.id, "viewer");

    const all = await (await list(apiRequest(token))).json();
    expect(all.suppliers[0]).toMatchObject({ id, contractedCents: 100_000, invoicedCents: 100_000, paidCents: 17_355, outstandingCents: 100_000, overdueCents: 100_000 });
    const one = await (await getOne(apiRequest(token), routeParams({ subcontractorId: id }))).json();
    expect(one.orders.map((o: { id: string }) => o.id)).toEqual([orderId]);
    expect(one.invoices.map((i: { number: string }) => i.number)).toEqual(["PL-1"]);
    expect(one.payments).toHaveLength(1);
  });

  it("needs a token and keeps tenants apart", async () => {
    const tenant = await createTestTenant();
    const ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" as const };
    const { id } = await subcontractorsService.createSubcontractor(ctx, {
      kind: "company",
      legalName: "Piedra de Liébana S.L.",
      taxId: "B39654322",
      address: "Barrio La Serna 7",
      postalCode: "39570",
      city: "Potes",
      suppliesOnly: true,
    });
    expect((await list(apiRequest(null))).status).toBe(401);
    const other = await createTestTenant();
    const { token } = await staffToken(other.id, "admin");
    expect((await getOne(apiRequest(token), routeParams({ subcontractorId: id }))).status).toBe(404);
    expect((await (await list(apiRequest(token))).json()).suppliers).toEqual([]);
  });
});
