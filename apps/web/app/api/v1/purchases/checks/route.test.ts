import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, resetDatabase } from "@repo/db/testing";
import { db, eq, purchaseDocumentChecks } from "@repo/db";
import { purchasingService, subcontractorsService } from "@repo/core";
import { files } from "@repo/core/testing";
import { apiRequest, routeParams, seededObraProject, staffToken } from "../../../../../test/api";
import { POST as addDocument } from "../[orderId]/documents/route";
import { GET as getOrder } from "../[orderId]/route";
import { POST as recheck } from "./[checkId]/recheck/route";
import { POST as dismiss } from "./[checkId]/dismiss/route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

async function setup() {
  const { tenant, project } = await seededObraProject();
  const ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" as const };
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
  const { orderId } = await purchasingService.createPurchase(ctx, project.id, { kind: "material", subcontractorId: supplierId, description: "Piedra", lines: [{ lineageId, amountCents: 1_000 }] });
  return { tenant, orderId };
}

describe("/api/v1 purchase document reviews", () => {
  it("queues an uploaded PDF, shows its review on the order, and asks again or marks it as seen", async () => {
    const { tenant, orderId } = await setup();
    const { token } = await staffToken(tenant.id, "manager");
    const form = new FormData();
    form.set("title", "Contrato");
    form.set("file", new File(["%PDF-1.7 contrato"], "contrato.pdf", { type: "application/pdf" }));
    expect((await addDocument(apiRequest(token, { method: "POST", body: form }), routeParams({ orderId }))).status).toBe(201);
    const [check] = (await (await getOrder(apiRequest(token), routeParams({ orderId }))).json()).checks;
    expect(check).toMatchObject({ subject: "order_document", status: "pending", label: "Contrato · v1" });

    const early = await dismiss(apiRequest(token, { method: "POST" }), routeParams({ checkId: check.id }));
    expect(early.status).toBe(409);
    expect(await early.json()).toEqual({ error: "invalid_state" });
    await db.update(purchaseDocumentChecks).set({ status: "done" }).where(eq(purchaseDocumentChecks.id, check.id));
    expect(await (await dismiss(apiRequest(token, { method: "POST" }), routeParams({ checkId: check.id }))).json()).toEqual({ checkId: check.id });
    expect(await (await recheck(apiRequest(token, { method: "POST" }), routeParams({ checkId: check.id }))).json()).toEqual({ checkId: check.id });
  });

  it("needs a token, lets viewers only read, and keeps tenants apart", async () => {
    const { tenant, orderId } = await setup();
    const { token } = await staffToken(tenant.id, "manager");
    const form = new FormData();
    form.set("title", "Contrato");
    form.set("file", new File(["%PDF-1.7 c"], "c.pdf", { type: "application/pdf" }));
    await addDocument(apiRequest(token, { method: "POST", body: form }), routeParams({ orderId }));
    const [check] = await db.select().from(purchaseDocumentChecks);
    await db.update(purchaseDocumentChecks).set({ status: "done" });
    expect((await recheck(apiRequest(null, { method: "POST" }), routeParams({ checkId: check!.id }))).status).toBe(401);
    const { token: viewer } = await staffToken(tenant.id, "viewer");
    expect((await dismiss(apiRequest(viewer, { method: "POST" }), routeParams({ checkId: check!.id }))).status).toBe(403);
    const other = await seededObraProject();
    const { token: stranger } = await staffToken(other.tenant.id, "admin");
    expect((await recheck(apiRequest(stranger, { method: "POST" }), routeParams({ checkId: check!.id }))).status).toBe(404);
  });
});
