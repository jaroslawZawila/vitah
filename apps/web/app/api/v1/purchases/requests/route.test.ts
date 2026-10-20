import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestUser, resetDatabase } from "@repo/db/testing";
import { purchasingService, subcontractorsService } from "@repo/core";
import { files } from "@repo/core/testing";
import { apiRequest, routeParams, seededObraProject, staffToken } from "../../../../../test/api";
import { GET as listAll } from "./route";
import { GET as getOne, PATCH as update } from "./[requestId]/route";
import { POST as decide } from "./[requestId]/decision/route";
import { POST as cancel } from "./[requestId]/cancel/route";
import { POST as create } from "../../projects/[id]/purchases/requests/route";
import { POST as createOrder } from "../../projects/[id]/purchases/route";
import { GET as getOrder } from "../[orderId]/route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
  vi.useFakeTimers({ toFake: ["Date"], now: new Date("2026-10-17T10:00:00Z") });
});

afterEach(() => vi.useRealTimers());

/** The seeded obra and the first line of chapter 06. */
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
  return { tenant, project, lineageId, supplierId };
}

const json = (body: unknown, method = "POST") => ({ method, body });

describe("/api/v1 purchase requests", () => {
  it("requests, edits, approves and orders", async () => {
    const { tenant, project, lineageId, supplierId } = await setup();
    const { token: manager } = await staffToken(tenant.id, "manager");
    const { token: admin } = await staffToken(tenant.id, "admin");

    const created = await create(
      apiRequest(manager, json({ kind: "material", description: "Piedra", neededBy: "2026-11-02", lines: [{ lineageId, amountCents: 300_000 }] })),
      routeParams({ id: project.id }),
    );
    expect(created.status).toBe(201);
    const { requestId, number } = await created.json();
    expect(number).toBe(1);

    expect((await update(apiRequest(manager, json({ notes: "Urgente" }, "PATCH")), routeParams({ requestId }))).status).toBe(200);
    expect((await decide(apiRequest(manager, json({ decision: "approve" })), routeParams({ requestId }))).status).toBe(403);
    const decided = await decide(apiRequest(admin, json({ decision: "approve" })), routeParams({ requestId }));
    expect(await decided.json()).toEqual({ requestId, status: "approved" });

    const order = await createOrder(
      apiRequest(manager, json({
        kind: "material",
        subcontractorId: supplierId,
        description: "Piedra",
        lines: [{ lineageId, amountCents: 290_000 }],
        requestId,
      })),
      routeParams({ id: project.id }),
    );
    expect(order.status).toBe(201);
    const { orderId } = await order.json();

    const detail = await (await getOne(apiRequest(manager), routeParams({ requestId }))).json();
    expect(detail).toMatchObject({ status: "ordered", notes: "Urgente", order: { id: orderId, number: 1 }, amountCents: 300_000 });
    expect((await (await getOrder(apiRequest(manager), routeParams({ orderId }))).json()).request).toEqual({ id: requestId, number: 1 });

    const all = await (await listAll(apiRequest(manager))).json();
    expect(all.requests.map((r: { id: string }) => r.id)).toEqual([requestId]);
    expect((await (await listAll(apiRequest(manager, { query: `?projectId=${project.id}` }))).json()).requests).toHaveLength(1);
    expect((await (await listAll(apiRequest(manager, { query: `?projectId=${project.id}` }))).json()).summary).toMatchObject({ pending: 0, approved: 0 });
  });

  it("rejects with a reason, cancels without a body, and answers errors as JSON", async () => {
    const { tenant, project, lineageId } = await setup();
    const { token: admin } = await staffToken(tenant.id, "admin");
    const body = { kind: "material", description: "Piedra", lines: [{ lineageId, amountCents: 1_000 }] };
    const first = (await (await create(apiRequest(admin, json(body)), routeParams({ id: project.id }))).json()).requestId;
    const missing = await decide(apiRequest(admin, json({ decision: "reject" })), routeParams({ requestId: first }));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "missing_fields" });
    expect((await decide(apiRequest(admin, json({ decision: "reject", note: "No" })), routeParams({ requestId: first }))).status).toBe(200);

    const second = (await (await create(apiRequest(admin, json(body)), routeParams({ id: project.id }))).json()).requestId;
    expect((await cancel(apiRequest(admin, { method: "POST" }), routeParams({ requestId: second }))).status).toBe(200);
    const again = await cancel(apiRequest(admin, { method: "POST" }), routeParams({ requestId: second }));
    expect(await again.json()).toEqual({ error: "invalid_state" });
  });

  it("needs a token and keeps tenants apart", async () => {
    const { tenant, project, lineageId } = await setup();
    const { token } = await staffToken(tenant.id, "manager");
    const body = { kind: "material", description: "Piedra", lines: [{ lineageId, amountCents: 1_000 }] };
    const { requestId } = await (await create(apiRequest(token, json(body)), routeParams({ id: project.id }))).json();
    expect((await listAll(apiRequest(null))).status).toBe(401);

    const other = await seededObraProject();
    const { token: stranger } = await staffToken(other.tenant.id, "admin");
    expect((await getOne(apiRequest(stranger), routeParams({ requestId }))).status).toBe(404);
    expect((await decide(apiRequest(stranger, json({ decision: "approve" })), routeParams({ requestId }))).status).toBe(404);
    expect((await (await listAll(apiRequest(stranger))).json()).requests).toEqual([]);
  });
});
