import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { purchasingService, subcontractorsService } from "@repo/core";
import { files } from "@repo/core/testing";
import { seedObra } from "@repo/core/seed";
import { signInAs } from "../../test/session";
import {
  addOrderDocumentAction,
  addOrderDocumentVersionAction,
  amendPurchaseAction,
  createPurchaseAction,
  deleteOrderDocumentAction,
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
  const order = { kind: "material", subcontractorId: supplierId, description: "Piedra", lines: [{ lineageId, amountCents: 300_000 }] };
  return { tenant, project, order };
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
    expect(await deleteOrderDocumentAction(project.id, orderId, documentId)).toEqual({ success: true });
    expect(await deleteOrderDocumentAction(project.id, orderId, documentId)).toEqual({ error: "not_found" });
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

  it("return the service's errors and nothing for another tenant", async () => {
    const { project, order } = await setup();
    expect(await createPurchaseAction(project.id, { ...order, lines: [] })).toEqual({ error: "missing_fields" });
    expect(await setPurchaseStatusAction(project.id, "nope", { status: "ordered" })).toEqual({ error: "not_found" });

    await setup();
    expect(await getProjectPurchases(project.id)).toBeNull();
    signInAs(null);
    expect(await getPurchases()).toBeNull();
  });
});
