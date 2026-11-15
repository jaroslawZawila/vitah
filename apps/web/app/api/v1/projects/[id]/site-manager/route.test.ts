import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { apiRequest, routeParams, staffToken } from "../../../../../../test/api";
import { GET, PUT } from "./route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

beforeEach(async () => {
  await resetDatabase();
});

describe("/api/v1/projects/:id/site-manager", () => {
  it("sets, reads and clears the project's site manager", async () => {
    const tenant = await createTestTenant();
    const { token, user } = await staffToken(tenant.id, "manager");
    const project = await createTestProject(tenant.id);
    const params = routeParams({ id: project.id });

    const put = await PUT(apiRequest(token, { method: "PUT", body: { userId: user.id } }), params);
    expect(put.status).toBe(200);
    expect(await put.json()).toEqual({ projectId: project.id, userId: user.id });

    const got = await GET(apiRequest(token), params);
    expect(got.status).toBe(200);
    const body = await got.json();
    expect(body.siteManager).toMatchObject({ id: user.id, email: user.email, phone: null });
    expect(body.options).toEqual([body.siteManager]);

    await PUT(apiRequest(token, { method: "PUT", body: { userId: null } }), params);
    expect((await (await GET(apiRequest(token), params)).json()).siteManager).toBeNull();
  });

  it("answers the service's errors as JSON codes", async () => {
    const tenant = await createTestTenant();
    const { token } = await staffToken(tenant.id, "admin");
    const project = await createTestProject(tenant.id);
    const client = await createTestUser(tenant.id, { role: "client" });
    const params = routeParams({ id: project.id });

    const missing = await PUT(apiRequest(token, { method: "PUT", body: {} }), params);
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ error: "missing_fields" });
    const notStaff = await PUT(apiRequest(token, { method: "PUT", body: { userId: client.id } }), params);
    expect(notStaff.status).toBe(404);
    expect(await notStaff.json()).toEqual({ error: "user_not_found" });
  });

  it("is not another tenant's project, nor a viewer's to use", async () => {
    const tenant = await createTestTenant();
    const other = await createTestTenant();
    const { token } = await staffToken(tenant.id, "admin");
    const { token: viewer } = await staffToken(tenant.id, "viewer");
    const theirs = await createTestProject(other.id);
    const ours = await createTestProject(tenant.id);

    const res = await GET(apiRequest(token), routeParams({ id: theirs.id }));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project_not_found" });
    expect((await GET(apiRequest(viewer), routeParams({ id: ours.id }))).status).toBe(403);
    expect((await GET(apiRequest(null), routeParams({ id: ours.id }))).status).toBe(401);
  });
});
