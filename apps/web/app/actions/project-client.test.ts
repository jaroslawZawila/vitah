import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, projects } from "@repo/db";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { signInAs } from "../../test/session";
import {
  assignProjectClientAction,
  getAssignableClients,
  unassignProjectClientAction,
} from "./project-client";

// The service itself is covered in packages/core; these tests cover the
// adapter: session → core → `{ error }` / revalidation.

vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

function pick(clientId: string) {
  const data = new FormData();
  data.set("clientId", clientId);
  return data;
}

async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const project = await createTestProject(tenant.id);
  const client = await createTestUser(tenant.id, { role: "client" });
  signInAs({ tenantId: tenant.id, userId: admin.id, role: "admin" });
  return { tenant, admin, project, client };
}

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
});

describe("client access actions", () => {
  it("lists assignable clients for admins only", async () => {
    const { tenant, admin, client } = await setup();

    expect((await getAssignableClients()).map((c) => c.id)).toEqual([client.id]);
    signInAs({ tenantId: tenant.id, userId: admin.id, role: "manager" });
    expect(await getAssignableClients()).toEqual([]);
  });

  it("assigns the client and revalidates the project pages", async () => {
    const { project, client } = await setup();

    expect(await assignProjectClientAction(project.id, null, pick(client.id))).toEqual({
      success: true,
    });

    const updated = await db.query.projects.findFirst({ where: eq(projects.id, project.id) });
    expect(updated?.clientUserId).toBe(client.id);
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`);
  });

  it("returns core errors as form state without revalidating", async () => {
    const { project } = await setup();

    expect(await assignProjectClientAction(project.id, null, pick("missing"))).toEqual({
      error: "client_not_found",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns forbidden for non-admins", async () => {
    const { tenant, admin, project, client } = await setup();
    signInAs({ tenantId: tenant.id, userId: admin.id, role: "manager" });

    expect(await assignProjectClientAction(project.id, null, pick(client.id))).toEqual({
      error: "forbidden",
    });
  });

  it("rejects anonymous requests", async () => {
    const { project, client } = await setup();
    signInAs(null);

    await expect(assignProjectClientAction(project.id, null, pick(client.id))).rejects.toThrow(
      "Unauthorized",
    );
  });

  it("removes the client from the project", async () => {
    const { project, client } = await setup();
    await assignProjectClientAction(project.id, null, pick(client.id));

    expect(await unassignProjectClientAction(project.id)).toEqual({ success: true });
    expect(await unassignProjectClientAction(project.id)).toEqual({ error: "no_client" });
  });
});
