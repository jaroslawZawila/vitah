import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { createMobileToken } from "@repo/auth/mobile";
import { DELETE, GET, PATCH } from "./route";

// Bearer requests never read the NextAuth session, and next-auth itself
// can't load outside Next.js.
vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

async function staffToken(tenantId: string) {
  const user = await createTestUser(tenantId, { role: "manager" });
  return createMobileToken({
    sub: user.id,
    email: user.email,
    name: user.name,
    role: "manager",
    tenantId,
  });
}

function call(
  handler: typeof GET,
  id: string,
  token: string,
  init: { method?: string; body?: unknown } = {},
) {
  const request = new Request(`http://localhost/api/v1/projects/${id}`, {
    method: init.method ?? "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return handler(request, { params: Promise.resolve({ id }) });
}

beforeEach(async () => {
  await resetDatabase();
});

describe("/api/v1/projects/:id", () => {
  it("reads, updates and deletes a project", async () => {
    const tenant = await createTestTenant();
    const token = await staffToken(tenant.id);
    const project = await createTestProject(tenant.id, {
      ref: "VTH-1",
      address: "Calle 1",
    });

    const read = await call(GET, project.id, token);
    expect(read.status).toBe(200);
    expect(await read.json()).toMatchObject({
      id: project.id,
      ref: "VTH-1",
      address: "Calle 1",
    });

    const patched = await call(PATCH, project.id, token, {
      method: "PATCH",
      body: { address: "Calle 2", completionDate: "2026-11-15" },
    });
    expect(patched.status).toBe(200);
    expect(await patched.json()).toEqual({ projectId: project.id });
    expect(await (await call(GET, project.id, token)).json()).toMatchObject({
      address: "Calle 2",
      completionDate: "2026-11-15T00:00:00.000Z",
    });

    const deleted = await call(DELETE, project.id, token, { method: "DELETE" });
    expect(deleted.status).toBe(204);
    expect((await call(GET, project.id, token)).status).toBe(404);
  });

  it("returns 404 for another tenant's project", async () => {
    const project = await createTestProject((await createTestTenant()).id);
    const token = await staffToken((await createTestTenant()).id);

    for (const [handler, method] of [
      [GET, "GET"],
      [PATCH, "PATCH"],
      [DELETE, "DELETE"],
    ] as const) {
      const res = await call(handler, project.id, token, {
        method,
        body: method === "PATCH" ? { address: "Hacked" } : undefined,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: "not_found" });
    }
  });

  it("rejects unauthenticated requests", async () => {
    const project = await createTestProject((await createTestTenant()).id);

    const res = await GET(
      new Request(`http://localhost/api/v1/projects/${project.id}`),
      {
        params: Promise.resolve({ id: project.id }),
      },
    );

    expect(res.status).toBe(401);
  });
});
