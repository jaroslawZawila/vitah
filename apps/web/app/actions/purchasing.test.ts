import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { purchaseInvoicesService, purchasingService, subcontractorsService } from "@repo/core";
import { files } from "@repo/core/testing";
import { seedObra } from "@repo/core/seed";
import { signInAs } from "../../test/session";
import { NOT_FOUND, TO_LOGIN } from "../../test/navigation";
import {
  addOrderDocumentAction,
  addOrderDocumentVersionAction,
  amendPurchaseAction,
  createPurchaseAction,
  deleteOrderDocumentAction,
  exportPurchases,
  getProjectPurchases,
  getPurchase,
  getPurchaseForm,
  getPurchases,
  setPurchaseStatusAction,
  updatePurchaseAction,
} from "./purchasing";

// The service is covered in packages/core; these tests cover the adapter:
// session → core → `{ error }` / revalidation.

vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

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
  signInAs({ tenantId: tenant.id, userId: user.id, role });
  const order = { kind: "material" as const, subcontractorId: supplierId, description: "Piedra", lines: [{ lineageId, amountCents: 300_000 }] };
  return { tenant, project, order, admin };
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.mocked(revalidatePath).mockClear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

describe("purchasing actions", () => {
  it("create, move, edit and attach to an order, refreshing the project, the Compras lists and the rail", async () => {
    const { project, order } = await setup();

    const created = await createPurchaseAction(project.id, order);
    expect(created).toEqual({ success: true, orderId: expect.any(String), number: 1 });
    const orderId = created!.orderId!;
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`, "layout");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");

    expect(await setPurchaseStatusAction(project.id, orderId, { status: "ordered", date: "2026-10-10" })).toEqual({ success: true });
    expect(await updatePurchaseAction(project.id, orderId, { notes: "Portes incluidos" })).toEqual({ success: true });
    const form = new FormData();
    form.set("title", "Contrato firmado");
    form.set("file", new File(["%PDF-1.7 pedido"], "pedido.pdf", { type: "application/pdf" }));
    expect(await addOrderDocumentAction(project.id, orderId, form)).toEqual({ success: true });
    const documentId = (await getPurchase(orderId))!.order.documents[0]!.id;
    const version = new FormData();
    version.set("file", new File(["%PDF-1.7 v2"], "pedido v2.pdf", { type: "application/pdf" }));
    version.set("note", "Firmado");
    expect(await addOrderDocumentVersionAction(project.id, orderId, documentId, version)).toEqual({ success: true });

    expect((await getPurchase(orderId))!.order).toMatchObject({
      status: "ordered",
      orderedOn: "2026-10-10",
      notes: "Portes incluidos",
      hasFile: true,
      documents: [{ title: "Contrato firmado", versions: [{ version: 2, note: "Firmado" }, { version: 1 }] }],
    });
    // A soft delete: the same answers, once; it leaves the order and the lists, and its files stay.
    const stored = files.size;
    expect(await deleteOrderDocumentAction(project.id, orderId, documentId)).toEqual({ success: true });
    expect(await deleteOrderDocumentAction(project.id, orderId, documentId)).toEqual({ error: "not_found" });
    expect((await getPurchase(orderId))!.order).toMatchObject({ documents: [], hasFile: false, file: null });
    expect((await getPurchases())!.purchases.orders[0]).toMatchObject({ id: orderId, hasFile: false });
    expect(files.size).toBe(stored);
  });

  it("edit an order's amount with its payment schedule following, or the error when it can't", async () => {
    const { project, order, admin } = await setup();
    const { orderId } = (await createPurchaseAction(project.id, { ...order, status: "ordered" }))!;
    await purchaseInvoicesService.setOrderMilestones(admin, orderId!, {
      milestones: [
        { concept: "Pedido", amountCents: 100_000 },
        { concept: "Entrega", amountCents: 200_000 },
      ],
    });
    const schedule = async () => (await getPurchase(orderId!))!.order.milestones.map((m) => [m.concept, m.amountCents]);
    const [first] = (await getPurchase(orderId!))!.order.milestones;
    await purchaseInvoicesService.createInvoice(admin, orderId!, { number: "PL-1", issuedOn: "2026-10-17", baseCents: 20_000, milestoneId: first!.id });

    expect(await updatePurchaseAction(project.id, orderId!, { lines: [{ ...order.lines[0]!, amountCents: 320_000 }] })).toEqual({ success: true });
    expect(await schedule()).toEqual([
      ["Pedido", 100_000],
      ["Entrega", 200_000],
      ["Ajuste por corrección del pedido", 20_000],
    ]);
    // Below the invoiced milestone: the others can't take the cut, and nothing moves.
    expect(await updatePurchaseAction(project.id, orderId!, { lines: [{ ...order.lines[0]!, amountCents: 90_000 }] })).toEqual({
      error: "milestones_cut",
    });
    expect((await getPurchase(orderId!))!.order.amountCents).toBe(320_000);
    expect(await schedule()).toHaveLength(3);
  });

  it("record a modificado on a placed order, refreshing the dashboard", async () => {
    const { project, order } = await setup();
    const created = await createPurchaseAction(project.id, { ...order, status: "ordered" });
    vi.mocked(revalidatePath).mockClear();
    const form = new FormData();
    form.set("data", JSON.stringify({ concept: "Más metros", lines: [{ ...order.lines[0]!, amountCents: 320_000 }] }));
    expect(await amendPurchaseAction(project.id, created!.orderId!, form)).toEqual({ success: true, number: 1 });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");
    expect((await getPurchase(created!.orderId!))!.order).toMatchObject({ amountCents: 320_000, originalAmountCents: 300_000 });
    expect(await amendPurchaseAction(project.id, created!.orderId!, form)).toEqual({ error: "no_changes" });
  });

  it("read the project's, the tenant's and the form, with whether the caller may edit", async () => {
    const { project, order } = await setup("viewer");
    expect(await createPurchaseAction(project.id, order)).toEqual({ error: "forbidden" });
    expect(revalidatePath).not.toHaveBeenCalled();

    expect(await getProjectPurchases(project.id)).toMatchObject({ canManage: false, purchases: { orders: [] } });
    expect(await getPurchases()).toMatchObject({ canManage: false, purchases: { orders: [] } });
    expect((await getPurchaseForm(project.id))!.form.suppliers).toHaveLength(1);
  });

  it("read a page of the tenant's orders with its filters, and every filtered order for the export", async () => {
    const { project, order, admin } = await setup("viewer");
    const ids: string[] = [];
    for (const description of ["Piedra", "Lámina", "Grava"]) {
      ids.unshift((await purchasingService.createPurchase(admin, project.id, { ...order, description, status: description === "Lámina" ? "pending" : "ordered" })).orderId);
    }
    const idsOf = (orders: { id: string }[]) => orders.map((o) => o.id);

    // Without a query: all of them, as before.
    expect(idsOf((await getPurchases())!.purchases.orders)).toEqual(ids);
    const page = (await getPurchases({ page: 2, limit: 2 }))!;
    expect(page.canManage).toBe(false);
    expect(idsOf(page.purchases.orders)).toEqual(ids.slice(2));
    expect(page.purchases.paging).toEqual({ page: 2, limit: 2, total: 3, pages: 2 });
    expect(page.purchases.groupCounts).toMatchObject({ all: 3, open: 2, pending: 1 });
    expect(idsOf((await getPurchases({ page: 1, group: "pending" }))!.purchases.orders)).toEqual([ids[1]]);
    expect(idsOf((await getPurchases({ page: 1, q: "grava" }))!.purchases.orders)).toEqual([ids[0]]);
    expect((await getPurchases({ page: 1, by: "supplier" }))!.purchases.bySupplier).toMatchObject([{ orders: 3 }]);
    // A page that isn't one is the service's error: nothing is read.
    expect(await getPurchases({ page: "abc" })).toBeNull();

    // The export: every order the filters keep, whatever page the screen shows.
    expect(idsOf(await exportPurchases({ group: "open" }))).toEqual([ids[0], ids[2]]);
    expect(idsOf(await exportPurchases({ ...({ page: 2, limit: 1 } as object), q: "" }))).toEqual(ids);
    // Signed out meanwhile: on to the login page, like every other read.
    signInAs(null);
    await expect(exportPurchases()).rejects.toEqual(TO_LOGIN);
  });

  it("return the service's errors and nothing for another tenant", async () => {
    const { project, order } = await setup();
    expect(await createPurchaseAction(project.id, { ...order, lines: [] })).toEqual({ error: "missing_fields" });
    expect(await setPurchaseStatusAction(project.id, "nope", { status: "ordered" })).toEqual({ error: "not_found" });

    await setup();
    await expect(getProjectPurchases(project.id)).rejects.toEqual(NOT_FOUND);
    signInAs(null);
    await expect(getPurchases()).rejects.toEqual(TO_LOGIN);
  });
});
