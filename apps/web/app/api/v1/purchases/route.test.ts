import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { purchasingService, subcontractorsService } from "@repo/core";
import { files } from "@repo/core/testing";
import { apiRequest, routeParams, seededObraProject, staffToken } from "../../../../test/api";
import { GET as listAll } from "./route";
import { GET as getOne, PATCH as update } from "./[orderId]/route";
import { POST as setStatus } from "./[orderId]/status/route";
import { DELETE as deleteFile, GET as getFile, POST as uploadFile } from "./[orderId]/file/route";
import { POST as addDocument } from "./[orderId]/documents/route";
import { DELETE as removeDocument, GET as getDocument, POST as addVersion } from "./[orderId]/documents/[documentId]/route";
import { GET as listProject, POST as create } from "../projects/[id]/purchases/route";
import { GET as getForm } from "../projects/[id]/purchases/form/route";
import { GET as supplierOrders } from "../subcontractors/[id]/purchases/route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

/** The seeded obra, a material supplier and the first line of chapter 06. */
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
  return { tenant, project, supplierId, lineageId };
}

const json = (body: unknown, method = "POST") => ({ method, body });

describe("/api/v1 purchases", () => {
  it("creates, reads, updates and moves an order", async () => {
    const { tenant, project, supplierId, lineageId } = await setup();
    const { token } = await staffToken(tenant.id);

    const form = await (await getForm(apiRequest(token), routeParams({ id: project.id }))).json();
    expect(form.nextNumber).toBe(1);
    expect(form.suppliers.map((s: { legalName: string }) => s.legalName)).toContain("Piedra de Liébana S.L.");

    const created = await create(
      apiRequest(token, json({ kind: "material", subcontractorId: supplierId, description: "Piedra", expectedOn: "2026-10-14", status: "ordered", lines: [{ lineageId, amountCents: 300_000 }] })),
      routeParams({ id: project.id }),
    );
    expect(created.status).toBe(201);
    const { orderId, number } = await created.json();
    expect(number).toBe(1);
    const missing = await create(apiRequest(token, json({ kind: "material", subcontractorId: supplierId })), routeParams({ id: project.id }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "missing_fields" });

    const patched = await update(apiRequest(token, json({ notes: "Portes incluidos" }, "PATCH")), routeParams({ orderId }));
    expect(await patched.json()).toEqual({ orderId });
    const moved = await setStatus(apiRequest(token, json({ status: "in_transit" })), routeParams({ orderId }));
    expect(await moved.json()).toEqual({ orderId, status: "in_transit" });
    const again = await setStatus(apiRequest(token, json({ status: "in_transit" })), routeParams({ orderId }));
    expect(again.status).toBe(409);

    const order = await (await getOne(apiRequest(token), routeParams({ orderId }))).json();
    expect(order).toMatchObject({ number: 1, status: "in_transit", notes: "Portes incluidos", lateDays: 3 });

    const view = await (await listProject(apiRequest(token), routeParams({ id: project.id }))).json();
    expect(view.summary).toMatchObject({ contractedCents: 300_000, lateDeliveries: 1 });
    const all = await (await listAll(apiRequest(token))).json();
    expect(all.orders.map((o: { id: string }) => o.id)).toEqual([orderId]);
    const theirs = await (await supplierOrders(apiRequest(token), routeParams({ id: supplierId }))).json();
    expect(theirs.map((o: { id: string }) => o.id)).toEqual([orderId]);
  });

  it("stores, downloads and removes the order's PDF", async () => {
    const { tenant, project, supplierId, lineageId } = await setup();
    const { token } = await staffToken(tenant.id);
    const { orderId } = await (
      await create(apiRequest(token, json({ kind: "material", subcontractorId: supplierId, description: "Piedra", lines: [{ lineageId, amountCents: 1 }] })), routeParams({ id: project.id }))
    ).json();

    const form = new FormData();
    form.set("file", new File(["%PDF-1.7 pedido"], "Pedido PED-001.pdf", { type: "application/pdf" }));
    expect((await uploadFile(apiRequest(token, { method: "POST", body: form }), routeParams({ orderId }))).status).toBe(201);
    const download = await getFile(apiRequest(token), routeParams({ orderId }));
    expect(download.headers.get("Content-Type")).toBe("application/pdf");
    expect(await download.text()).toBe("%PDF-1.7 pedido");
    expect(await (await deleteFile(apiRequest(token, { method: "DELETE" }), routeParams({ orderId }))).json()).toEqual({ orderId });
  });

  it("keeps several documents per order, each in versions", async () => {
    const { tenant, project, supplierId, lineageId } = await setup();
    const { token } = await staffToken(tenant.id);
    const { orderId } = await (
      await create(apiRequest(token, json({ kind: "material", subcontractorId: supplierId, description: "Piedra", lines: [{ lineageId, amountCents: 1 }] })), routeParams({ id: project.id }))
    ).json();
    const upload = (fields: Record<string, string>, content: string) => {
      const form = new FormData();
      for (const [key, value] of Object.entries(fields)) form.set(key, value);
      form.set("file", new File([content], "doc.pdf", { type: "application/pdf" }));
      return apiRequest(token, { method: "POST", body: form });
    };

    const added = await addDocument(upload({ title: "Contrato firmado" }, "%PDF-1.7 v1"), routeParams({ orderId }));
    expect(added.status).toBe(201);
    const { documentId, version } = await added.json();
    expect(version).toBe(1);
    expect(await (await addVersion(upload({ note: "Firmado" }, "%PDF-1.7 v2"), routeParams({ orderId, documentId }))).json()).toEqual({ documentId, version: 2 });
    expect((await addDocument(upload({}, "%PDF-1.7 x"), routeParams({ orderId }))).status).toBe(400);

    const order = await (await getOne(apiRequest(token), routeParams({ orderId }))).json();
    expect(order.documents).toMatchObject([{ id: documentId, title: "Contrato firmado", versions: [{ version: 2, note: "Firmado" }, { version: 1 }] }]);
    expect(await (await getDocument(apiRequest(token), routeParams({ orderId, documentId }))).text()).toBe("%PDF-1.7 v2");
    const older = order.documents[0].versions[1].id;
    expect(await (await getDocument(apiRequest(token, { query: `?versionId=${older}` }), routeParams({ orderId, documentId }))).text()).toBe("%PDF-1.7 v1");
    // The single PDF older clients know is the first document.
    expect(await (await getFile(apiRequest(token), routeParams({ orderId }))).text()).toBe("%PDF-1.7 v2");

    expect(await (await removeDocument(apiRequest(token, { method: "DELETE" }), routeParams({ orderId, documentId }))).json()).toEqual({ documentId });
    expect((await getDocument(apiRequest(token), routeParams({ orderId, documentId }))).status).toBe(404);
  });

  it("needs a token, lets viewers only read, and keeps tenants apart", async () => {
    const { tenant, project, supplierId, lineageId } = await setup();
    expect((await listAll(apiRequest(null))).status).toBe(401);

    const viewer = await staffToken(tenant.id, "viewer");
    const denied = await create(
      apiRequest(viewer.token, json({ kind: "material", subcontractorId: supplierId, description: "x", lines: [{ lineageId, amountCents: 1 }] })),
      routeParams({ id: project.id }),
    );
    expect(denied.status).toBe(403);
    expect((await listProject(apiRequest(viewer.token), routeParams({ id: project.id }))).status).toBe(200);

    const manager = await staffToken(tenant.id);
    const { orderId } = await (
      await create(apiRequest(manager.token, json({ kind: "material", subcontractorId: supplierId, description: "x", lines: [{ lineageId, amountCents: 1 }] })), routeParams({ id: project.id }))
    ).json();

    const other = await createTestTenant();
    const { token } = await staffToken(other.id);
    expect(await (await getOne(apiRequest(token), routeParams({ orderId }))).json()).toEqual({ error: "not_found" });
    expect((await listProject(apiRequest(token), routeParams({ id: project.id }))).status).toBe(404);
    expect((await listAll(apiRequest(token))).status).toBe(200);
    expect((await (await listAll(apiRequest(token))).json()).orders).toEqual([]);
  });
});
