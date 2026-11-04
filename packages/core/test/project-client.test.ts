import { beforeEach, describe, expect, it } from "vitest";
import { db, eq, projects, users } from "@repo/db";
import {
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { normalizeEmail, projectClientService as svc, type Ctx } from "../src";

async function findProject(id: string) {
  return db.query.projects.findFirst({ where: eq(projects.id, id) });
}

/** A tenant with an admin caller, one project and one unassigned client. */
async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const project = await createTestProject(tenant.id);
  const client = await createTestUser(tenant.id, {
    role: "client",
    name: "Ana García",
    email: `ana-${tenant.slug}@example.com`,
  });
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  return { tenant, admin, project, client, ctx };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });
});

describe("listAssignableClients", () => {
  it("lists every active client, those with a project too", async () => {
    const { tenant, project, client, ctx } = await setup();
    const assigned = await createTestUser(tenant.id, { role: "client", name: "Bea Ruiz" });
    await db.update(projects).set({ clientUserId: assigned.id }).where(eq(projects.id, project.id));
    await createTestUser(tenant.id, { role: "client", active: false });
    await createTestUser(tenant.id, { role: "manager" });
    await setup(); // another tenant's client

    expect(await svc.listAssignableClients(ctx)).toEqual([
      { id: client.id, name: "Ana García", email: client.email },
      { id: assigned.id, name: "Bea Ruiz", email: assigned.email },
    ]);
  });

  it("is admin only", async () => {
    const { ctx } = await setup();

    await expect(svc.listAssignableClients({ ...ctx, role: "manager" })).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});

describe("assignProjectClient", () => {
  it("attaches the client to the project", async () => {
    const { project, client, ctx } = await setup();

    await expect(
      svc.assignProjectClient(ctx, project.id, { clientId: client.id }),
    ).resolves.toEqual({ projectId: project.id });

    expect((await findProject(project.id))?.clientUserId).toBe(client.id);
  });

  it("requires a client id", async () => {
    const { project, ctx } = await setup();

    await expect(svc.assignProjectClient(ctx, project.id, { clientId: " " })).rejects.toMatchObject(
      { code: "missing_fields", status: 400 },
    );
  });

  it("rejects a project from another tenant", async () => {
    const { client, ctx } = await setup();
    const other = await setup();

    await expect(
      svc.assignProjectClient(ctx, other.project.id, { clientId: client.id }),
    ).rejects.toMatchObject({ code: "project_not_found", status: 404 });
    expect((await findProject(other.project.id))?.clientUserId).toBeNull();
  });

  it.each([
    ["a client from another tenant", async () => (await setup()).client.id],
    ["a staff user", async (tenantId: string) => (await createTestUser(tenantId)).id],
    [
      "an inactive client",
      async (tenantId: string) =>
        (await createTestUser(tenantId, { role: "client", active: false })).id,
    ],
    ["an unknown id", async () => "missing"],
  ])("rejects %s", async (_label, makeClientId) => {
    const { tenant, project, ctx } = await setup();
    const clientId = await makeClientId(tenant.id);

    await expect(svc.assignProjectClient(ctx, project.id, { clientId })).rejects.toMatchObject({
      code: "client_not_found",
      status: 404,
    });
    expect((await findProject(project.id))?.clientUserId).toBeNull();
  });

  it("rejects a project that already has a client", async () => {
    const { tenant, project, client, ctx } = await setup();
    const second = await createTestUser(tenant.id, { role: "client" });
    await svc.assignProjectClient(ctx, project.id, { clientId: client.id });

    await expect(
      svc.assignProjectClient(ctx, project.id, { clientId: second.id }),
    ).rejects.toMatchObject({ code: "client_already_attached", status: 409 });
  });

  it("attaches a client who already has another project", async () => {
    const { tenant, project, client, ctx } = await setup();
    const otherProject = await createTestProject(tenant.id);
    await svc.assignProjectClient(ctx, project.id, { clientId: client.id });

    await svc.assignProjectClient(ctx, otherProject.id, { clientId: client.id });

    expect((await findProject(project.id))?.clientUserId).toBe(client.id);
    expect((await findProject(otherProject.id))?.clientUserId).toBe(client.id);
  });

  it.each(["manager", "viewer"] as const)("is admin only (%s is forbidden)", async (role) => {
    const { project, client, ctx } = await setup();

    await expect(
      svc.assignProjectClient({ ...ctx, role }, project.id, { clientId: client.id }),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });
});

describe("unassignProjectClient", () => {
  it("detaches the client but keeps their account", async () => {
    const { project, client, ctx } = await setup();
    await svc.assignProjectClient(ctx, project.id, { clientId: client.id });

    await expect(svc.unassignProjectClient(ctx, project.id)).resolves.toEqual({
      projectId: project.id,
    });

    expect((await findProject(project.id))?.clientUserId).toBeNull();
    expect(await db.query.users.findFirst({ where: eq(users.id, client.id) })).toBeDefined();
    expect((await svc.listAssignableClients(ctx)).map((c) => c.id)).toEqual([client.id]);
  });

  it("reports when the project has no client", async () => {
    const { project, ctx } = await setup();

    await expect(svc.unassignProjectClient(ctx, project.id)).rejects.toMatchObject({
      code: "no_client",
      status: 404,
    });
  });

  it("does not touch projects from another tenant", async () => {
    const a = await setup();
    const b = await setup();
    await svc.assignProjectClient(a.ctx, a.project.id, { clientId: a.client.id });

    await expect(svc.unassignProjectClient(b.ctx, a.project.id)).rejects.toMatchObject({
      code: "no_client",
    });
    expect((await findProject(a.project.id))?.clientUserId).toBe(a.client.id);
  });

  it("is admin only", async () => {
    const { project, ctx } = await setup();

    await expect(
      svc.unassignProjectClient({ ...ctx, role: "viewer" }, project.id),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
