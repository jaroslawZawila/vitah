import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { db, eq, purchaseOrders } from "@repo/db";
import {
  budgetService,
  purchaseInvoicesService,
  purchaseRequestsService as svc,
  purchasingService,
  subcontractorsService,
  type Ctx,
} from "../src";
import { addDays, todayInSpain } from "../src/obra-calc";
import { framerDraft } from "./budget-fixture";

vi.mock("../src/storage", () => import("../src/testing"));

const company = (overrides: Record<string, unknown> = {}) => ({
  kind: "company",
  legalName: "Montajes Steel Norte S.L.",
  taxId: "B39123450",
  address: "Polígono Raos 4",
  postalCode: "39600",
  city: "Maliaño",
  ...overrides,
});

/**
 * A project with an accepted budget of chapters 01–03 (one line of 1.000 € at
 * cost each), a subcontractor and a material supplier; a manager asks.
 */
async function setup(role: Ctx["role"] = "manager") {
  const tenant = await createTestTenant();
  const admin: Ctx = { tenantId: tenant.id, userId: (await createTestUser(tenant.id, { role: "admin", name: "Ana Admin" })).id, role: "admin" };
  const user = await createTestUser(tenant.id, { role, name: "Laura Pérez" });
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role };
  const project = await createTestProject(tenant.id);
  const { revisionId } = await framerDraft(admin, project.id, ["01", "02", "03"]);
  await budgetService.acceptRevision(admin, project.id, revisionId);
  const { id: subcontractorId } = await subcontractorsService.createSubcontractor(admin, company());
  const { id: supplierId } = await subcontractorsService.createSubcontractor(
    admin,
    company({ legalName: "Piedra de Liébana S.L.", taxId: "B39654322", suppliesOnly: true }),
  );
  const form = await purchasingService.getPurchaseForm(admin, project.id);
  const lineage = (code: string) => form.chapters.find((c) => c.code === code)!.lines[0]!.lineageId;
  return { tenant, admin, ctx, project, subcontractorId, supplierId, lineage };
}

type Setup = Awaited<ReturnType<typeof setup>>;

const request = (s: Setup, overrides: Record<string, unknown> = {}) => ({
  kind: "material",
  description: "Piedra para la fachada",
  neededBy: addDays(todayInSpain(), 20),
  subcontractorId: s.supplierId,
  notes: "Misma cantera que la muestra",
  lines: [
    { lineageId: s.lineage("01"), amountCents: 60_000 },
    { lineageId: s.lineage("02"), amountCents: 30_000 },
  ],
  ...overrides,
});

/** The order made from a request: its lines and supplier. */
const orderOf = (s: Setup, requestId: string, overrides: Record<string, unknown> = {}) => ({
  kind: "material",
  subcontractorId: s.supplierId,
  description: "Piedra para la fachada",
  lines: [{ lineageId: s.lineage("01"), amountCents: 58_000 }],
  requestId,
  ...overrides,
});

beforeEach(async () => {
  await resetDatabase();
});

describe("purchase requests", () => {
  it("numbers a project's requests and lists those to decide first, with their estimate", async () => {
    const s = await setup();
    const first = await svc.createRequest(s.ctx, s.project.id, request(s));
    const second = await svc.createRequest(s.ctx, s.project.id, request(s, { description: "Estructura", kind: "subcontract", subcontractorId: s.subcontractorId, lines: [{ lineageId: s.lineage("03"), amountCents: 90_000 }] }));
    expect([first.number, second.number]).toEqual([1, 2]);
    await svc.decideRequest(s.admin, first.requestId, { decision: "approve" });

    const list = await svc.listRequests(s.ctx);
    expect(list.requests.map((r) => [r.number, r.status, r.amountCents, r.chapterCodes])).toEqual([
      [2, "pending", 90_000, ["03"]],
      [1, "approved", 90_000, ["01", "02"]],
    ]);
    expect(list.requests[1]).toMatchObject({
      projectRef: s.project.ref,
      supplierName: "Piedra de Liébana S.L.",
      createdBy: "Laura Pérez",
      order: null,
      lateDays: null,
    });
    expect(list.summary).toEqual({ pending: 1, pendingCents: 90_000, approved: 1, approvedCents: 90_000 });
    expect(list.projects.map((p) => p.id)).toEqual([s.project.id]);
    expect((await purchaseInvoicesService.getPurchasingCounts(s.ctx)).requests).toBe(1);

    const other = await createTestProject(s.tenant.id);
    expect((await svc.listRequests(s.ctx, { projectId: other.id })).requests).toEqual([]);
  });

  it("shows a request's lines against the budget and what the orders already contract", async () => {
    const s = await setup();
    await purchasingService.createPurchase(s.admin, s.project.id, {
      kind: "material",
      subcontractorId: s.supplierId,
      description: "Anticipo",
      status: "ordered",
      lines: [{ lineageId: s.lineage("01"), amountCents: 10_000, closesLine: false }],
    });
    const { requestId } = await svc.createRequest(s.ctx, s.project.id, request(s));
    const detail = await svc.getRequest(s.ctx, requestId);
    expect(detail.lines.map((l) => [l.chapterCode, l.costCents, l.contractedCents, l.amountCents])).toEqual([
      ["01", 100_000, 10_000, 60_000],
      ["02", 100_000, 0, 30_000],
    ]);
    expect(detail.lines[0]).toMatchObject({ code: expect.stringMatching(/^01\./), description: expect.any(String) });
    expect(detail).toMatchObject({ notes: "Misma cantera que la muestra", decidedBy: null, decisionNote: null });
    expect(detail.events.map((e) => e.action)).toEqual(["created"]);
  });

  it("becomes an order once approved, and the two stay linked", async () => {
    const s = await setup();
    const { requestId } = await svc.createRequest(s.ctx, s.project.id, request(s));
    // Not before it is approved, nor with an empty id.
    await expect(purchasingService.createPurchase(s.ctx, s.project.id, orderOf(s, requestId))).rejects.toMatchObject({ code: "request_not_approved" });
    await expect(purchasingService.createPurchase(s.ctx, s.project.id, orderOf(s, ""))).rejects.toMatchObject({ code: "invalid_input" });
    await svc.decideRequest(s.admin, requestId, { decision: "approve", note: "Adelante" });

    const { orderId, number } = await purchasingService.createPurchase(s.ctx, s.project.id, orderOf(s, requestId));
    const detail = await svc.getRequest(s.ctx, requestId);
    expect(detail).toMatchObject({ status: "ordered", order: { id: orderId, number }, decidedBy: "Ana Admin", decisionNote: "Adelante" });
    expect(detail.events.map((e) => e.action)).toEqual(["ordered", "approved", "created"]);
    const order = await purchasingService.getPurchase(s.ctx, orderId);
    expect(order.request).toEqual({ id: requestId, number: 1 });
    expect(order.events.at(-1)).toMatchObject({ action: "created", detail: { requestId } });

    // Once only: the second order isn't made at all.
    await expect(purchasingService.createPurchase(s.ctx, s.project.id, orderOf(s, requestId))).rejects.toMatchObject({ code: "request_not_approved" });
    expect(await db.select().from(purchaseOrders).where(eq(purchaseOrders.projectId, s.project.id))).toHaveLength(1);
    // Ordered, it can no longer be cancelled.
    await expect(svc.cancelRequest(s.ctx, requestId)).rejects.toMatchObject({ code: "invalid_state" });
    expect((await svc.listRequests(s.ctx)).summary).toMatchObject({ pending: 0, approved: 0 });
  });

  it("is rejected with a reason, by an admin only", async () => {
    const s = await setup();
    const { requestId } = await svc.createRequest(s.ctx, s.project.id, request(s));
    await expect(svc.decideRequest(s.ctx, requestId, { decision: "approve" })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.decideRequest(s.admin, requestId, { decision: "reject" })).rejects.toMatchObject({ code: "missing_fields" });
    await expect(svc.decideRequest(s.admin, requestId, { decision: "maybe" })).rejects.toMatchObject({ code: "invalid_input" });
    await svc.decideRequest(s.admin, requestId, { decision: "reject", note: "Hay stock en otra obra" });

    const detail = await svc.getRequest(s.ctx, requestId);
    expect(detail).toMatchObject({ status: "rejected", decisionNote: "Hay stock en otra obra", lateDays: null });
    expect(detail.events[0]).toMatchObject({ action: "rejected", note: "Hay stock en otra obra", by: "Ana Admin" });
    // Decided once; a rejected request is closed.
    await expect(svc.decideRequest(s.admin, requestId, { decision: "approve" })).rejects.toMatchObject({ code: "invalid_state" });
    await expect(svc.cancelRequest(s.ctx, requestId)).rejects.toMatchObject({ code: "invalid_state" });
    await expect(svc.updateRequest(s.ctx, requestId, { description: "Otra" })).rejects.toMatchObject({ code: "invalid_state" });
    await expect(purchasingService.createPurchase(s.ctx, s.project.id, orderOf(s, requestId))).rejects.toMatchObject({ code: "request_not_approved" });
  });

  it("is approved again when its order is cancelled, ready for another order", async () => {
    const s = await setup();
    const { requestId } = await svc.createRequest(s.ctx, s.project.id, request(s));
    await svc.decideRequest(s.admin, requestId, { decision: "approve" });
    const first = await purchasingService.createPurchase(s.ctx, s.project.id, orderOf(s, requestId));
    await purchasingService.setPurchaseStatus(s.ctx, first.orderId, { status: "cancelled", note: "Proveedor equivocado" });

    const reopened = await svc.getRequest(s.ctx, requestId);
    expect(reopened).toMatchObject({ status: "approved", order: null });
    expect(reopened.events[0]).toMatchObject({ action: "reopened", detail: { orderId: first.orderId, number: first.number } });
    const second = await purchasingService.createPurchase(s.ctx, s.project.id, orderOf(s, requestId));
    expect((await svc.getRequest(s.ctx, requestId)).order).toEqual({ id: second.orderId, number: second.number });
    // An order of its own cancels as before.
    const own = await purchasingService.createPurchase(s.ctx, s.project.id, orderOf(s, requestId, { requestId: undefined }));
    await purchasingService.setPurchaseStatus(s.ctx, own.orderId, { status: "cancelled" });
    expect((await svc.getRequest(s.ctx, requestId)).status).toBe("ordered");
  });

  it("keeps another editor's change: an edit writes only what it changes", async () => {
    const s = await setup();
    const { requestId } = await svc.createRequest(s.ctx, s.project.id, request(s));
    await Promise.all([
      svc.updateRequest(s.ctx, requestId, { neededBy: "2026-12-01" }),
      svc.updateRequest(s.admin, requestId, { notes: "Con palés" }),
    ]);
    expect(await svc.getRequest(s.ctx, requestId)).toMatchObject({ neededBy: "2026-12-01", notes: "Con palés" });
  });

  it("is edited while pending, each change logged, and cancelled while still open", async () => {
    const s = await setup();
    const { requestId } = await svc.createRequest(s.ctx, s.project.id, request(s));
    await svc.updateRequest(s.ctx, requestId, {
      description: "Piedra y mortero",
      neededBy: null,
      lines: [{ lineageId: s.lineage("02"), amountCents: 45_000 }],
    });
    const edited = await svc.getRequest(s.ctx, requestId);
    expect(edited).toMatchObject({ description: "Piedra y mortero", neededBy: null, amountCents: 45_000, chapterCodes: ["02"] });
    // Logged as an order's edits: the fields, and the lines that changed (one transaction, one timestamp).
    const byAction = new Map(edited.events.map((e) => [e.action, e]));
    expect(byAction.get("updated")).toMatchObject({ detail: { fields: { description: { from: "Piedra para la fachada", to: "Piedra y mortero" } } } });
    expect(byAction.get("lines")).toMatchObject({
      detail: {
        changes: [
          { lineageId: s.lineage("01"), from: { amountCents: 60_000 }, to: null },
          { lineageId: s.lineage("02"), from: { amountCents: 30_000 }, to: { amountCents: 45_000 } },
        ],
      },
    });
    // The same lines again change nothing and log nothing.
    await svc.updateRequest(s.ctx, requestId, { lines: [{ lineageId: s.lineage("02"), amountCents: 45_000 }] });
    expect((await svc.getRequest(s.ctx, requestId)).events).toHaveLength(edited.events.length);
    // A subcontract can't go to a material supplier.
    await expect(svc.updateRequest(s.ctx, requestId, { kind: "subcontract" })).rejects.toMatchObject({ code: "supplies_only" });
    await svc.updateRequest(s.ctx, requestId, { kind: "subcontract", subcontractorId: s.subcontractorId });

    await svc.decideRequest(s.admin, requestId, { decision: "approve" });
    await expect(svc.updateRequest(s.ctx, requestId, { description: "Tarde" })).rejects.toMatchObject({ code: "invalid_state" });
    await svc.cancelRequest(s.ctx, requestId, { note: "Lo pone el cliente" });
    const cancelled = await svc.getRequest(s.ctx, requestId);
    expect(cancelled.status).toBe("cancelled");
    expect(cancelled.events[0]).toMatchObject({ action: "cancelled", detail: { from: "approved" }, note: "Lo pone el cliente" });
  });

  it("checks what it asks for", async () => {
    const s = await setup();
    const reject = (overrides: Record<string, unknown>) => svc.createRequest(s.ctx, s.project.id, request(s, overrides));
    await expect(reject({ description: " " })).rejects.toMatchObject({ code: "missing_fields" });
    await expect(reject({ lines: [] })).rejects.toMatchObject({ code: "missing_fields" });
    await expect(reject({ lines: [{ lineageId: "nope", amountCents: 1 }] })).rejects.toMatchObject({ code: "unknown_line" });
    await expect(reject({ lines: [{ lineageId: s.lineage("01"), amountCents: 0 }] })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(reject({ kind: "subcontract" })).rejects.toMatchObject({ code: "supplies_only" });
    await expect(reject({ subcontractorId: "nope" })).rejects.toMatchObject({ code: "unknown_supplier" });
    await expect(reject({ neededBy: "2026-02-30" })).rejects.toMatchObject({ code: "invalid_date" });
    // No supplier is fine: the office picks one when it orders.
    expect(await reject({ subcontractorId: null })).toMatchObject({ number: 1 });

    const viewer = await setup("viewer");
    await expect(svc.createRequest(viewer.ctx, viewer.project.id, request(viewer))).rejects.toMatchObject({ code: "forbidden" });
    expect((await svc.listRequests(viewer.ctx)).requests).toEqual([]);
  });

  it("shows how late an open request is past its needed-by day", async () => {
    const s = await setup();
    const { requestId } = await svc.createRequest(s.ctx, s.project.id, request(s, { neededBy: addDays(todayInSpain(), -3) }));
    expect((await svc.getRequest(s.ctx, requestId)).lateDays).toBe(3);
    await svc.cancelRequest(s.ctx, requestId);
    expect((await svc.getRequest(s.ctx, requestId)).lateDays).toBeNull();
  });

  it("stays within its tenant and project", async () => {
    const s = await setup();
    const other = await setup();
    const { requestId } = await svc.createRequest(s.ctx, s.project.id, request(s));
    await svc.decideRequest(s.admin, requestId, { decision: "approve" });

    await expect(svc.getRequest(other.ctx, requestId)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.decideRequest(other.admin, requestId, { decision: "reject", note: "x" })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.updateRequest(other.ctx, requestId, { description: "x" })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.cancelRequest(other.ctx, requestId)).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.createRequest(other.ctx, s.project.id, request(other))).rejects.toMatchObject({ code: "project_not_found" });
    expect((await svc.listRequests(other.ctx)).requests).toEqual([]);
    expect((await purchaseInvoicesService.getPurchasingCounts(other.ctx)).requests).toBe(0);

    // Another project's request doesn't become this project's order.
    const second = await createTestProject(s.tenant.id);
    const { revisionId } = await framerDraft(s.admin, second.id, ["01"]);
    await budgetService.acceptRevision(s.admin, second.id, revisionId);
    const form = await purchasingService.getPurchaseForm(s.admin, second.id);
    await expect(
      purchasingService.createPurchase(s.ctx, second.id, orderOf(s, requestId, { lines: [{ lineageId: form.chapters[0]!.lines[0]!.lineageId, amountCents: 1_000 }] })),
    ).rejects.toMatchObject({ code: "not_found" });
    expect((await svc.getRequest(s.ctx, requestId)).status).toBe("approved");
  });
});
