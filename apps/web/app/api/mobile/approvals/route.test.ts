import { beforeEach, describe, expect, it, vi } from "vitest";
import { budgetApprovalsService } from "@repo/core";
import { files } from "@repo/core/testing";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { CLIENT_PASSWORD, issuedChange } from "../../../../test/approval-fixture";
import { apiRequest, clientToken, routeParams, staffToken } from "../../../../test/api";
import { GET } from "./route";
import { POST as decide } from "./[id]/decision/route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

/** A change asked of the client, and the client's token. */
async function setup() {
  const s = await issuedChange();
  const { approvalId } = await budgetApprovalsService.askApproval(s.staff, s.project.id, s.revisionId, { message: "La piscina" });
  return { ...s, approvalId, token: await clientToken(s.tenant.id, s.client.id, s.client.email) };
}

const read = async (token: string, query = "") => (await GET(apiRequest(token, { query }))).json();
const answer = (token: string | null, approvalId: string, body: unknown) =>
  decide(apiRequest(token, { method: "POST", body }), routeParams({ id: approvalId }));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("GET /api/mobile/approvals", () => {
  it("gives the change waiting for the client on the home shown, and null on another", async () => {
    const { approvalId, token, tenant, client, project } = await setup();
    expect((await read(token)).approval).toMatchObject({ id: approvalId, revisionNumber: 1, message: "La piscina", changeReason: "Piscina" });

    // The newer home becomes the default one.
    const otherHome = await createTestProject(tenant.id, { clientUserId: client.id });
    expect((await read(token, `?projectId=${project.id}`)).approval).toMatchObject({ id: approvalId });
    expect(await read(token, `?projectId=${otherHome.id}`)).toEqual({ approval: null });
  });

  it("is 404 for another client's home, and for staff and the signed out a 401", async () => {
    const { project, tenant } = await setup();
    const stranger = await createTestUser(tenant.id, { role: "client" });
    const strangerToken = await clientToken(tenant.id, stranger.id, stranger.email);

    const res = await GET(apiRequest(strangerToken, { query: `?projectId=${project.id}` }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project_not_found" });
    expect(await read(strangerToken)).toEqual({ approval: null });
    expect((await GET(apiRequest((await staffToken(tenant.id)).token))).status).toBe(401);
    expect((await GET(apiRequest(null))).status).toBe(401);
  });
});

describe("POST /api/mobile/approvals/:id/decision", () => {
  it("approves with the client's password, once", async () => {
    const { approvalId, token } = await setup();

    const wrong = await answer(token, approvalId, { decision: "approve", password: "nope" });
    expect(wrong.status).toBe(400);
    expect(await wrong.json()).toEqual({ error: "wrong_password" });

    const res = await answer(token, approvalId, { decision: "approve", password: CLIENT_PASSWORD, afterCents: 1 });
    expect(res.status).toBe(200);
    const approved = await res.json();
    expect(approved).toEqual({ approval: { id: approvalId, status: "approved", decidedAt: expect.any(String) } });
    expect(await read(token)).toEqual({ approval: null });

    // Sent again (the first reply was lost): what was recorded.
    const retry = await answer(token, approvalId, { decision: "approve", password: CLIENT_PASSWORD });
    expect(retry.status).toBe(200);
    expect(await retry.json()).toEqual(approved);

    const again = await answer(token, approvalId, { decision: "reject", reason: "Ya no" });
    expect(again.status).toBe(409);
    expect(await again.json()).toEqual({ error: "approval_closed" });
  });

  it("rejects with a reason; without one, 400", async () => {
    const { approvalId, token } = await setup();

    expect((await answer(token, approvalId, { decision: "reject" })).status).toBe(400);
    expect((await answer(token, approvalId, { decision: "reject", reason: "Muy cara" })).status).toBe(200);
  });

  it("is 404 for another client's or tenant's request, and 409 once withdrawn", async () => {
    const { approvalId, token, tenant, staff, project, revisionId } = await setup();
    const stranger = await createTestUser(tenant.id, { role: "client", password: CLIENT_PASSWORD });
    const otherTenant = await createTestTenant();
    const outsider = await createTestUser(otherTenant.id, { role: "client", password: CLIENT_PASSWORD });

    for (const user of [stranger, outsider]) {
      const res = await answer(await clientToken(user.tenantId, user.id, user.email), approvalId, { decision: "approve", password: CLIENT_PASSWORD });
      expect(res.status).toBe(404);
    }
    expect((await answer(null, approvalId, { decision: "approve", password: CLIENT_PASSWORD })).status).toBe(401);

    await budgetApprovalsService.withdrawApproval(staff, project.id, revisionId);
    expect((await answer(token, approvalId, { decision: "approve", password: CLIENT_PASSWORD })).status).toBe(409);
  });
});
