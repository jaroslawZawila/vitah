import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { purchasingService, subcontractorsService } from "@repo/core";
import { files } from "@repo/core/testing";
import { seedObra } from "@repo/core/seed";
import { signInAs } from "../../test/session";
import {
  createPurchaseAction,
  deletePurchaseFileAction,
  getProjectPurchases,
  getPurchase,
  getPurchaseForm,
  getPurchases,
  setPurchaseStatusAction,
  updatePurchaseAction,
  uploadPurchaseFileAction,
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
    form.set("file", new File(["%PDF-1.7 pedido"], "pedido.pdf", { type: "application/pdf" }));
    expect(await uploadPurchaseFileAction(project.id, orderId, null, form)).toEqual({ success: true });

    expect((await getPurchase(orderId))!.order).toMatchObject({ status: "ordered", orderedOn: "2026-10-10", notes: "Portes incluidos", hasFile: true });
    expect(await deletePurchaseFileAction(project.id, orderId)).toEqual({ success: true });
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
