import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { purchasingService, subcontractorsService } from "@repo/core";
import { files } from "@repo/core/testing";
import { apiRequest, routeParams, seededObraProject, staffToken } from "../../../../test/api";
import { GET as listAll } from "./route";
import { GET as getOne, PATCH as update } from "./[orderId]/route";
import { POST as setStatus } from "./[orderId]/status/route";
import { POST as amend } from "./[orderId]/amendments/route";
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
    // A soft delete: the same answer, once; the PDF is no longer served, and stays stored.
    const stored = files.size;
    const removed = await deleteFile(apiRequest(token, { method: "DELETE" }), routeParams({ orderId }));
    expect([removed.status, await removed.json()]).toEqual([200, { orderId }]);
    expect((await deleteFile(apiRequest(token, { method: "DELETE" }), routeParams({ orderId }))).status).toBe(404);
    expect((await getFile(apiRequest(token), routeParams({ orderId }))).status).toBe(404);
    expect(files.size).toBe(stored);
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

    // A soft delete: the same answer, once; it leaves the order and is no longer served, and its files stay.
    const stored = files.size;
    const removed = await removeDocument(apiRequest(token, { method: "DELETE" }), routeParams({ orderId, documentId }));
    expect([removed.status, await removed.json()]).toEqual([200, { documentId }]);
    expect((await removeDocument(apiRequest(token, { method: "DELETE" }), routeParams({ orderId, documentId }))).status).toBe(404);
    expect((await getDocument(apiRequest(token), routeParams({ orderId, documentId }))).status).toBe(404);
    expect((await getDocument(apiRequest(token, { query: `?versionId=${older}` }), routeParams({ orderId, documentId }))).status).toBe(404);
    expect((await getFile(apiRequest(token), routeParams({ orderId }))).status).toBe(404);
    const after = await (await getOne(apiRequest(token), routeParams({ orderId }))).json();
    expect(after).toMatchObject({ documents: [], hasFile: false, file: null });
    expect((await (await listAll(apiRequest(token))).json()).orders[0]).toMatchObject({ id: orderId, hasFile: false });
    expect(files.size).toBe(stored);
  });

  it("records a placed order's modificado, as JSON or with its signed PDF", async () => {
    const { tenant, project, supplierId, lineageId } = await setup();
    const { token } = await staffToken(tenant.id);
    const created = await create(
      apiRequest(token, json({ kind: "material", subcontractorId: supplierId, description: "Piedra", status: "ordered", lines: [{ lineageId, amountCents: 300_000 }] })),
      routeParams({ id: project.id }),
    );
    const { orderId } = await created.json();

    const first = await amend(apiRequest(token, json({ concept: "Más metros", lines: [{ lineageId, amountCents: 330_000 }] })), routeParams({ orderId }));
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({ amendmentId: expect.any(String), number: 1, deltaCents: 30_000 });
    const form = new FormData();
    form.set("data", JSON.stringify({ concept: "Portes", lines: [{ lineageId, amountCents: 340_000 }], documentTitle: "Modificado nº 2" }));
    form.set("file", new File(["%PDF-1.7 mod"], "mod.pdf", { type: "application/pdf" }));
    expect(await (await amend(apiRequest(token, { method: "POST", body: form }), routeParams({ orderId }))).json()).toMatchObject({ number: 2 });
    const same = await amend(apiRequest(token, json({ concept: "Nada", lines: [{ lineageId, amountCents: 340_000 }] })), routeParams({ orderId }));
    expect(same.status).toBe(400);
    expect(await same.json()).toEqual({ error: "no_changes" });

    const order = await (await getOne(apiRequest(token), routeParams({ orderId }))).json();
    expect(order).toMatchObject({ amountCents: 340_000, originalAmountCents: 300_000 });
    expect(order.amendments.map((a: { number: number; document: { title: string } | null }) => [a.number, a.document?.title ?? null])).toEqual([
      [2, "Modificado nº 2"],
      [1, null],
    ]);
  });

  it("pages and filters the tenant's orders, and without parameters answers as it always did", async () => {
    const { tenant, project, supplierId, lineageId } = await setup();
    const ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin" })).id, role: "admin" as const };
    const ids: string[] = [];
    for (const [description, status] of [["Piedra", "ordered"], ["Lámina", "pending"], ["Grava", "ordered"]] as const) {
      const input = { kind: "material", subcontractorId: supplierId, description, status, expectedOn: "2026-10-10", lines: [{ lineageId, amountCents: 100_000 }] };
      ids.unshift((await purchasingService.createPurchase(ctx, project.id, input)).orderId);
    }
    const { token } = await staffToken(tenant.id, "viewer");
    const get = async (query = "") => {
      const response = await listAll(apiRequest(token, { query }));
      return { status: response.status, body: await response.json() };
    };
    const idsOf = (body: { orders: { id: string }[] }) => body.orders.map((o) => o.id);

    // No parameters: every order, with the fields older clients read (and the new ones beside them).
    const all = await get();
    expect(all.status).toBe(200);
    expect(idsOf(all.body)).toEqual(ids);
    expect(Object.keys(all.body)).toEqual(expect.arrayContaining(["orders", "projects", "summary", "today"]));
    expect(all.body.summary).toMatchObject({ openOrders: 2, pendingOrders: 1, lateDeliveries: 2 });
    expect(all.body.paging).toEqual({ page: 1, limit: 5000, total: 3, pages: 1 });

    // A page at a time; the totals stay the whole list's.
    const first = await get("?page=1&limit=2");
    expect(idsOf(first.body)).toEqual(ids.slice(0, 2));
    expect(first.body.paging).toEqual({ page: 1, limit: 2, total: 3, pages: 2 });
    expect(first.body.groupCounts).toEqual({ all: 3, open: 2, pending: 1, done: 0, cancelled: 0 });
    expect(first.body.summary).toEqual(all.body.summary);
    expect(idsOf((await get("?page=2&limit=2")).body)).toEqual(ids.slice(2));
    expect((await get("?page=3&limit=2")).body).toMatchObject({ orders: [], paging: { page: 3, total: 3, pages: 2 } });
    // A huge limit is cut, not refused.
    expect((await get("?limit=1000000")).body.paging).toMatchObject({ limit: 200, total: 3 });

    // Filters, applied by the server.
    expect(idsOf((await get("?page=1&group=pending")).body)).toEqual([ids[1]]);
    expect(idsOf((await get("?page=1&q=gra")).body)).toEqual([ids[0]]);
    expect(idsOf((await get(`?page=1&late=1&projectId=${project.id}&supplierId=${supplierId}&kind=material&from=2026-10-01`)).body)).toEqual([ids[0], ids[2]]);
    expect(idsOf((await get("?page=1&projectId=nope")).body)).toEqual([]);
    expect((await get("?page=1&by=supplier")).body.bySupplier).toMatchObject([{ id: supplierId, orders: 3, contractedCents: 200_000 }]);

    // A page, a limit or a filter that isn't one: 400, never a 500 nor everything.
    for (const query of ["?page=0", "?page=abc", "?page=-1", "?page=1.5", "?limit=0", "?limit=x"]) {
      expect(await get(query), query).toEqual({ status: 400, body: { error: "invalid_page" } });
    }
    expect(await get("?group=nope")).toEqual({ status: 400, body: { error: "invalid_input" } });
    expect(await get("?from=2026-02-31")).toEqual({ status: 400, body: { error: "invalid_date" } });
  });

  it("needs a token, lets viewers only read, and keeps tenants apart", async () => {
    const { tenant, project, supplierId, lineageId } = await setup();
    expect((await listAll(apiRequest(null))).status).toBe(401);
    expect((await listAll(apiRequest(null, { query: "?page=1" }))).status).toBe(401);

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
    expect(await (await listAll(apiRequest(token, { query: `?page=1&projectId=${project.id}` }))).json()).toMatchObject({ orders: [], paging: { total: 0 } });
  });
});
