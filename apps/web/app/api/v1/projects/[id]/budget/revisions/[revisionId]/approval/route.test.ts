import { beforeEach, describe, expect, it, vi } from "vitest";
import { budgetService } from "@repo/core";
import { files } from "@repo/core/testing";
import { createTestTenant, resetDatabase } from "@repo/db/testing";
import { issuedChange } from "../../../../../../../../../test/approval-fixture";
import { apiRequest, routeParams, staffToken } from "../../../../../../../../../test/api";
import { DELETE, POST } from "./route";
import { DELETE as unlink, PUT as link } from "../changes/[issueId]/route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

async function setup(role: "manager" | "viewer" = "manager") {
  const s = await issuedChange();
  const { token } = await staffToken(s.tenant.id, role);
  const params = routeParams({ id: s.project.id, revisionId: s.revisionId });
  const changeParams = routeParams({ id: s.project.id, revisionId: s.revisionId, issueId: s.issueId });
  return { ...s, token, params, changeParams };
}

describe("/api/v1/projects/:id/budget/revisions/:revisionId/approval and …/changes/:issueId", () => {
  it("links a change, asks the client, and withdraws", async () => {
    const { token, params, changeParams, staff, project, revisionId } = await setup();

    const linked = await link(apiRequest(token, { method: "PUT" }), changeParams);
    expect(linked.status).toBe(200);

    const asked = await POST(apiRequest(token, { method: "POST", body: { message: "La piscina" } }), params);
    expect(asked.status).toBe(201);
    const { approvalId } = await asked.json();
    // No body at all: a message and options are optional.
    expect((await POST(apiRequest(token, { method: "POST" }), params)).status).toBe(409);
    expect((await unlink(apiRequest(token, { method: "DELETE" }), changeParams)).status).toBe(409);

    const { revision } = await budgetService.getBudget(staff, project.id, revisionId);
    expect(revision!.changes).toHaveLength(1);
    expect(revision!.approvals).toEqual([expect.objectContaining({ id: approvalId, status: "pending" })]);

    const withdrawn = await DELETE(apiRequest(token, { method: "DELETE" }), params);
    expect(withdrawn.status).toBe(200);
    expect(await withdrawn.json()).toEqual({ approvalId });
    expect((await unlink(apiRequest(token, { method: "DELETE" }), changeParams)).status).toBe(200);
  });

  it("is for admins and managers of the project's tenant", async () => {
    const { params, changeParams, tenant } = await setup();
    const viewer = (await staffToken(tenant.id, "viewer")).token;
    const outsider = (await staffToken((await createTestTenant()).id)).token;

    expect((await POST(apiRequest(viewer, { method: "POST" }), params)).status).toBe(403);
    expect((await link(apiRequest(viewer, { method: "PUT" }), changeParams)).status).toBe(403);
    expect((await POST(apiRequest(outsider, { method: "POST" }), params)).status).toBe(404);
    expect((await POST(apiRequest(null, { method: "POST" }), params)).status).toBe(401);
  });
});
