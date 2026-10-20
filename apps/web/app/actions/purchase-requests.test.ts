import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { purchasingService, subcontractorsService } from "@repo/core";
import { seedObra } from "@repo/core/seed";
import { signInAs } from "../../test/session";
import {
  cancelRequestAction,
  createRequestAction,
  decideRequestAction,
  getRequest,
  getRequests,
  updateRequestAction,
} from "./purchase-requests";
import { createPurchaseAction, getPurchase } from "./purchasing";
import { getPurchasingCounts } from "./purchase-invoices";

// The service is covered in packages/core; these tests cover the adapter:
// session → core → `{ error }` / revalidation.

vi.mock("@repo/core/storage", () => import("@repo/core/testing"));
vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

/** The seeded obra; a manager asks for chapter 06's first line, an admin decides. */
async function setup(role: "manager" | "viewer" = "manager") {
  const tenant = await createTestTenant();
  const staff = await createTestUser(tenant.id, { role: "admin" });
  const user = await createTestUser(tenant.id, { role });
  const project = await createTestProject(tenant.id);
  const admin = { tenantId: tenant.id, userId: staff.id, role: "admin" as const };
  const ctx = { tenantId: tenant.id, userId: user.id, role };
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
  signInAs(ctx);
  const request = { kind: "material", description: "Piedra", neededBy: "2026-11-02", lines: [{ lineageId, amountCents: 300_000 }] };
  return { project, admin, ctx, request, lineageId, supplierId };
}

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

describe("purchase request actions", () => {
  it("request, edit, approve and order, refreshing the dashboard (lists and the rail)", async () => {
    const s = await setup();
    const created = await createRequestAction(s.project.id, s.request);
    expect(created).toEqual({ success: true, requestId: expect.any(String), number: 1 });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard", "layout");
    const requestId = created!.requestId!;
    expect(await updateRequestAction(requestId, { notes: "Misma cantera" })).toEqual({ success: true });
    expect(await getPurchasingCounts()).toMatchObject({ requests: 1 });

    // A manager can't decide; an admin can.
    expect(await decideRequestAction(requestId, { decision: "approve" })).toEqual({ error: "forbidden" });
    expect((await getRequest(requestId))!).toMatchObject({ canManage: true, canDecide: false, request: { status: "pending", notes: "Misma cantera" } });
    signInAs(s.admin);
    expect(await decideRequestAction(requestId, { decision: "approve" })).toEqual({ success: true });
    expect((await getRequest(requestId))!.canDecide).toBe(true);

    signInAs(s.ctx);
    const order = await createPurchaseAction(s.project.id, {
      kind: "material",
      subcontractorId: s.supplierId,
      description: "Piedra",
      lines: s.request.lines,
      requestId,
    });
    expect(order).toMatchObject({ success: true, orderId: expect.any(String) });
    expect((await getRequest(requestId))!.request).toMatchObject({ status: "ordered", order: { id: order!.orderId } });
    expect((await getPurchase(order!.orderId!))!.order.request).toEqual({ id: requestId, number: 1 });
    expect((await getRequests(s.project.id))!.requests.requests.map((r) => r.status)).toEqual(["ordered"]);
    expect(await cancelRequestAction(requestId)).toEqual({ error: "invalid_state" });
  });

  it("reject with a reason and cancel, returning the service's errors", async () => {
    const s = await setup();
    const { requestId } = (await createRequestAction(s.project.id, s.request))!;
    expect(await createRequestAction(s.project.id, { ...s.request, lines: [] })).toEqual({ error: "missing_fields" });
    signInAs(s.admin);
    expect(await decideRequestAction(requestId!, { decision: "reject" })).toEqual({ error: "missing_fields" });
    expect(await decideRequestAction(requestId!, { decision: "reject", note: "Hay stock" })).toEqual({ success: true });

    signInAs(s.ctx);
    const second = (await createRequestAction(s.project.id, s.request))!.requestId!;
    expect(await cancelRequestAction(second, { note: "Ya no hace falta" })).toEqual({ success: true });
    expect((await getRequests())!.requests.summary).toMatchObject({ pending: 0, approved: 0 });
  });

  it("let viewers read only, and show nothing of another tenant or signed out", async () => {
    const s = await setup("viewer");
    expect(await createRequestAction(s.project.id, s.request)).toEqual({ error: "forbidden" });
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(await getRequests()).toMatchObject({ canManage: false, requests: { requests: [] } });

    const other = await setup();
    const { requestId } = (await createRequestAction(other.project.id, other.request))!;
    signInAs(s.ctx);
    expect(await getRequest(requestId!)).toBeNull();
    expect(await updateRequestAction(requestId!, { notes: "x" })).toEqual({ error: "forbidden" });
    signInAs(null);
    expect(await getRequests()).toBeNull();
  });
});
