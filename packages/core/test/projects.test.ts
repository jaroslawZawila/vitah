import { beforeEach, describe, expect, it } from "vitest";
import {
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { projectsService as svc, type Ctx } from "../src";

async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  return { tenant, ctx };
}

/** A caller in a different tenant. */
async function otherTenantCtx(): Promise<Ctx> {
  return (await setup()).ctx;
}

beforeEach(async () => {
  await resetDatabase();
});

describe("createProject with a client", () => {
  const base = { ref: "VTH-26-020", address: "Calle Mayor 1, Santander" };

  it("attaches a free client in the same step", async () => {
    const { tenant, ctx } = await setup();
    const client = await createTestUser(tenant.id, { role: "client" });

    const { id } = await svc.createProject(ctx, {
      ...base,
      clientId: client.id,
    });

    expect((await svc.getProject(ctx, id))?.client?.id).toBe(client.id);
  });

  it("treats an empty clientId as no client", async () => {
    const { ctx } = await setup();

    const { id } = await svc.createProject(ctx, { ...base, clientId: "" });

    expect((await svc.getProject(ctx, id))?.clientUserId).toBeNull();
  });

  it("is admin only when a client is given", async () => {
    const { tenant, ctx } = await setup();
    const client = await createTestUser(tenant.id, { role: "client" });

    await expect(
      svc.createProject(
        { ...ctx, role: "manager" },
        { ...base, clientId: client.id },
      ),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
    expect(await svc.listProjects(ctx)).toEqual([]);
  });

  it.each([
    [
      "another tenant's client",
      async () =>
        (
          await createTestUser((await createTestTenant()).id, {
            role: "client",
          })
        ).id,
    ],
    [
      "a staff user",
      async (tenantId: string) => (await createTestUser(tenantId)).id,
    ],
    [
      "an inactive client",
      async (tenantId: string) =>
        (await createTestUser(tenantId, { role: "client", active: false })).id,
    ],
  ])(
    "rejects %s without creating the project",
    async (_label, makeClientId) => {
      const { tenant, ctx } = await setup();
      const clientId = await makeClientId(tenant.id);

      await expect(
        svc.createProject(ctx, { ...base, clientId }),
      ).rejects.toMatchObject({
        code: "client_not_found",
        status: 404,
      });
      expect(await svc.listProjects(ctx)).toEqual([]);
    },
  );

  it("rejects a client already on another project", async () => {
    const { tenant, ctx } = await setup();
    const client = await createTestUser(tenant.id, { role: "client" });
    await svc.createProject(ctx, { ...base, clientId: client.id });

    await expect(
      svc.createProject(ctx, {
        ...base,
        ref: "VTH-26-021",
        clientId: client.id,
      }),
    ).rejects.toMatchObject({ code: "client_has_project", status: 409 });
    expect(await svc.listProjects(ctx)).toHaveLength(1);
  });
});

describe("createProject", () => {
  it("creates a project with ref, address and dates", async () => {
    const { ctx } = await setup();

    const { id } = await svc.createProject(ctx, {
      ref: " VTH-26-010 ",
      address: " Calle del Sol 5, Santander ",
      startDate: "2026-03-01",
      completionDate: "2026-11-15",
    });

    expect(await svc.getProject(ctx, id)).toMatchObject({
      id,
      tenantId: ctx.tenantId,
      ref: "VTH-26-010",
      address: "Calle del Sol 5, Santander",
      startDate: new Date("2026-03-01"),
      completionDate: new Date("2026-11-15"),
      clientUserId: null,
      client: null,
    });
  });

  it("leaves dates empty when they are not given", async () => {
    const { ctx } = await setup();

    const { id } = await svc.createProject(ctx, {
      ref: "VTH-1",
      address: "Calle 1",
      startDate: "",
    });

    expect(await svc.getProject(ctx, id)).toMatchObject({
      startDate: null,
      completionDate: null,
    });
  });

  it.each([
    [{ address: "Calle 1" }],
    [{ ref: "VTH-1" }],
    [{ ref: "  ", address: "Calle 1" }],
    [{ ref: 1, address: 2 }],
  ])("rejects missing fields %j", async (input) => {
    const { ctx } = await setup();

    await expect(svc.createProject(ctx, input)).rejects.toMatchObject({
      code: "missing_fields",
      status: 400,
    });
  });

  it("rejects an invalid date", async () => {
    const { ctx } = await setup();

    await expect(
      svc.createProject(ctx, {
        ref: "VTH-1",
        address: "Calle 1",
        startDate: "not-a-date",
      }),
    ).rejects.toMatchObject({ code: "invalid_date", status: 400 });
  });

  it("rejects a duplicate ref within the tenant, but allows it in another tenant", async () => {
    const { ctx } = await setup();
    await svc.createProject(ctx, { ref: "VTH-1", address: "Calle 1" });

    await expect(
      svc.createProject(ctx, { ref: "VTH-1", address: "Calle 2" }),
    ).rejects.toMatchObject({ code: "ref_exists", status: 400 });
    await expect(
      svc.createProject(await otherTenantCtx(), {
        ref: "VTH-1",
        address: "Calle 2",
      }),
    ).resolves.toHaveProperty("id");
  });
});

describe("listProjects / getProject", () => {
  it("returns only the caller's tenant projects, newest first, with their client", async () => {
    const { tenant, ctx } = await setup();
    const client = await createTestUser(tenant.id, {
      role: "client",
      name: "Ana",
    });
    const older = await createTestProject(tenant.id, {
      createdAt: new Date("2026-01-01"),
    });
    const newer = await createTestProject(tenant.id, {
      createdAt: new Date("2026-02-01"),
      clientUserId: client.id,
    });
    const foreign = await createTestProject((await createTestTenant()).id);

    const list = await svc.listProjects(ctx);
    expect(list.map((p) => p.id)).toEqual([newer.id, older.id]);
    expect(list[0]!.client).toEqual({
      id: client.id,
      name: "Ana",
      email: client.email,
    });
    expect(list[1]!.client).toBeNull();

    expect(await svc.getProject(ctx, foreign.id)).toBeNull();
    expect(await svc.getProject(ctx, "missing")).toBeNull();
  });
});

describe("updateProject", () => {
  it("updates address and dates, ignoring unknown keys", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id, { ref: "VTH-1" });

    await expect(
      svc.updateProject(ctx, project.id, {
        address: "Calle Nueva 2",
        startDate: "2026-04-01",
        completionDate: "2026-12-01",
        ref: "VTH-CHANGED",
        tenantId: "hijack",
      }),
    ).resolves.toEqual({ projectId: project.id });

    expect(await svc.getProject(ctx, project.id)).toMatchObject({
      ref: "VTH-1",
      tenantId: tenant.id,
      address: "Calle Nueva 2",
      startDate: new Date("2026-04-01"),
      completionDate: new Date("2026-12-01"),
    });
  });

  it("keeps fields that are not provided and clears empty dates", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id, {
      address: "Calle 1",
      startDate: new Date("2026-03-01"),
      completionDate: new Date("2026-11-15"),
    });

    await svc.updateProject(ctx, project.id, { completionDate: "" });

    expect(await svc.getProject(ctx, project.id)).toMatchObject({
      address: "Calle 1",
      startDate: new Date("2026-03-01"),
      completionDate: null,
    });
  });

  it("rejects an empty address", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);

    await expect(
      svc.updateProject(ctx, project.id, { address: " " }),
    ).rejects.toMatchObject({
      code: "missing_fields",
    });
  });

  it("does not update another tenant's project", async () => {
    const { tenant } = await setup();
    const project = await createTestProject(tenant.id, { address: "Calle 1" });

    await expect(
      svc.updateProject(await otherTenantCtx(), project.id, {
        address: "Hacked",
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect(
      (
        await svc.listProjects({
          tenantId: tenant.id,
          userId: "x",
          role: "admin",
        })
      )[0],
    ).toMatchObject({
      address: "Calle 1",
    });
  });
});

describe("deleteProject", () => {
  it("deletes a project in the tenant", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);

    await expect(svc.deleteProject(ctx, project.id)).resolves.toEqual({
      projectId: project.id,
    });
    expect(await svc.getProject(ctx, project.id)).toBeNull();
  });

  it("does not delete another tenant's project", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id);

    await expect(
      svc.deleteProject(await otherTenantCtx(), project.id),
    ).rejects.toMatchObject({
      code: "not_found",
    });
    expect(await svc.getProject(ctx, project.id)).not.toBeNull();
  });
});
