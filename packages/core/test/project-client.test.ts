import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it } from "vitest";
import { db, eq, projectActivityLog, projects, users } from "@repo/db";
import {
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { normalizeEmail, projectClientService as svc, type Ctx } from "../src";

const validInput = { name: "Ana García", email: "ana@example.com", password: "s3cret-pass" };

async function findUser(email: string) {
  return db.query.users.findFirst({ where: eq(users.email, email) });
}

async function findProject(id: string) {
  return db.query.projects.findFirst({ where: eq(projects.id, id) });
}

async function activityFor(projectId: string) {
  return db.query.projectActivityLog.findMany({
    where: eq(projectActivityLog.projectId, projectId),
  });
}

/** A tenant with an admin caller and one project. */
async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const project = await createTestProject(tenant.id);
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  return { tenant, admin, project, ctx };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Ana@Example.COM ")).toBe("ana@example.com");
  });
});

describe("createProjectClient", () => {
  it("creates a client user, attaches them to the project and logs it", async () => {
    const { tenant, admin, project, ctx } = await setup();

    const result = await svc.createProjectClient(ctx, project.id, {
      ...validInput,
      name: "  Ana García ",
      email: " ANA@example.com",
    });

    expect(result).toEqual({ projectId: project.id });
    const client = await findUser("ana@example.com");
    expect(client).toMatchObject({ tenantId: tenant.id, name: "Ana García", role: "client" });
    expect(await bcrypt.compare(validInput.password, client!.passwordHash!)).toBe(true);
    expect((await findProject(project.id))?.clientUserId).toBe(client!.id);
    expect(await activityFor(project.id)).toEqual([
      expect.objectContaining({
        userId: admin.id,
        action: "client_access_granted",
        detail: "Acceso a la app concedido a ana@example.com",
      }),
    ]);
  });

  it.each([
    [{ ...validInput, name: "  " }, "missing_fields", 400],
    [{ ...validInput, email: "" }, "missing_fields", 400],
    [{ ...validInput, password: "" }, "missing_fields", 400],
    [{ name: 1, email: 2, password: 3 }, "missing_fields", 400],
    [{ ...validInput, email: "not-an-email" }, "invalid_email", 400],
    [{ ...validInput, password: "short" }, "password_too_short", 400],
  ])("rejects invalid input %j with %s", async (input, code, status) => {
    const { project, ctx } = await setup();

    await expect(svc.createProjectClient(ctx, project.id, input)).rejects.toMatchObject({
      code,
      status,
    });
    expect(await findUser(validInput.email)).toBeUndefined();
    expect(await activityFor(project.id)).toHaveLength(0);
  });

  it.each(["manager", "viewer"] as const)("is admin only (%s is forbidden)", async (role) => {
    const { project, ctx } = await setup();

    await expect(
      svc.createProjectClient({ ...ctx, role }, project.id, validInput),
    ).rejects.toMatchObject({ code: "forbidden", status: 403 });
  });

  it("rejects a project from another tenant", async () => {
    const { ctx } = await setup();
    const other = await createTestTenant();
    const project = await createTestProject(other.id);

    await expect(svc.createProjectClient(ctx, project.id, validInput)).rejects.toMatchObject({
      code: "project_not_found",
      status: 404,
    });
    expect(await findUser(validInput.email)).toBeUndefined();
  });

  it("rejects a project that already has a client", async () => {
    const { project, ctx } = await setup();
    await svc.createProjectClient(ctx, project.id, validInput);

    await expect(
      svc.createProjectClient(ctx, project.id, { ...validInput, email: "other@example.com" }),
    ).rejects.toMatchObject({ code: "client_already_attached", status: 409 });
    expect(await findUser("other@example.com")).toBeUndefined();
  });

  it("rejects an email already used by a client in another tenant", async () => {
    const a = await setup();
    const b = await setup();
    await svc.createProjectClient(a.ctx, a.project.id, validInput);

    await expect(svc.createProjectClient(b.ctx, b.project.id, validInput)).rejects.toMatchObject({
      code: "email_exists",
      status: 409,
    });
    expect((await findProject(b.project.id))?.clientUserId).toBeNull();
  });

  it("rejects an email already used by staff in the same tenant", async () => {
    const { tenant, project, ctx } = await setup();
    await createTestUser(tenant.id, { email: validInput.email, role: "manager" });

    await expect(svc.createProjectClient(ctx, project.id, validInput)).rejects.toMatchObject({
      code: "email_exists",
    });
  });

  it("allows an email used by staff in another tenant", async () => {
    const { project, ctx } = await setup();
    const other = await createTestTenant();
    await createTestUser(other.id, { email: validInput.email, role: "admin" });

    await expect(svc.createProjectClient(ctx, project.id, validInput)).resolves.toEqual({
      projectId: project.id,
    });
  });
});

describe("getClientProject", () => {
  it("returns the project attached to the client in mobile shape", async () => {
    const { tenant, ctx } = await setup();
    const project = await createTestProject(tenant.id, {
      ref: "VTH-2026-014",
      location: "Calle del Sol 5, Santander",
      startDate: new Date("2026-03-01T00:00:00Z"),
      expectedDeliveryDate: new Date("2026-11-15T00:00:00Z"),
    });
    await svc.createProjectClient(ctx, project.id, validInput);
    const client = await findUser(validInput.email);

    expect(await svc.getClientProject(tenant.id, client!.id)).toEqual({
      id: project.id,
      ref: "VTH-2026-014",
      address: "Calle del Sol 5, Santander",
      startDate: "2026-03-01",
      completionDate: "2026-11-15",
    });
  });

  it("returns null dates when they are not set", async () => {
    const { tenant, project, ctx } = await setup();
    await svc.createProjectClient(ctx, project.id, validInput);
    const client = await findUser(validInput.email);

    expect(await svc.getClientProject(tenant.id, client!.id)).toMatchObject({
      startDate: null,
      completionDate: null,
    });
  });

  it("returns null when the user has no project", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, { role: "client" });

    expect(await svc.getClientProject(tenant.id, client.id)).toBeNull();
  });

  it("does not return a project from another tenant", async () => {
    const { project, ctx } = await setup();
    await svc.createProjectClient(ctx, project.id, validInput);
    const client = await findUser(validInput.email);
    const other = await createTestTenant();

    expect(await svc.getClientProject(other.id, client!.id)).toBeNull();
  });
});

describe("resetProjectClientPassword", () => {
  it("replaces the client's password and logs it", async () => {
    const { project, ctx } = await setup();
    await svc.createProjectClient(ctx, project.id, validInput);

    await expect(
      svc.resetProjectClientPassword(ctx, project.id, { password: "brand-new-pass" }),
    ).resolves.toEqual({ projectId: project.id });

    const client = await findUser(validInput.email);
    expect(await bcrypt.compare("brand-new-pass", client!.passwordHash!)).toBe(true);
    expect(await bcrypt.compare(validInput.password, client!.passwordHash!)).toBe(false);
    expect((await activityFor(project.id)).map((a) => a.action)).toContain(
      "client_password_reset",
    );
  });

  it("rejects a short password", async () => {
    const { project, ctx } = await setup();
    await svc.createProjectClient(ctx, project.id, validInput);

    await expect(
      svc.resetProjectClientPassword(ctx, project.id, { password: "short" }),
    ).rejects.toMatchObject({ code: "password_too_short" });
  });

  it("reports when the project has no client", async () => {
    const { project, ctx } = await setup();

    await expect(
      svc.resetProjectClientPassword(ctx, project.id, { password: "brand-new-pass" }),
    ).rejects.toMatchObject({ code: "no_client", status: 404 });
  });

  it("does not touch projects from another tenant", async () => {
    const a = await setup();
    const b = await setup();
    await svc.createProjectClient(a.ctx, a.project.id, validInput);

    await expect(
      svc.resetProjectClientPassword(b.ctx, a.project.id, { password: "brand-new-pass" }),
    ).rejects.toMatchObject({ code: "no_client" });
    const client = await findUser(validInput.email);
    expect(await bcrypt.compare(validInput.password, client!.passwordHash!)).toBe(true);
  });

  it("is admin only", async () => {
    const { project, ctx } = await setup();

    await expect(
      svc.resetProjectClientPassword({ ...ctx, role: "manager" }, project.id, {
        password: "brand-new-pass",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

describe("revokeProjectClient", () => {
  it("deletes the client, frees the project and logs it", async () => {
    const { project, ctx } = await setup();
    await svc.createProjectClient(ctx, project.id, validInput);

    await expect(svc.revokeProjectClient(ctx, project.id)).resolves.toEqual({
      projectId: project.id,
    });

    expect(await findUser(validInput.email)).toBeUndefined();
    expect((await findProject(project.id))?.clientUserId).toBeNull();
    expect((await activityFor(project.id)).map((a) => a.action)).toContain(
      "client_access_revoked",
    );
    await expect(svc.createProjectClient(ctx, project.id, validInput)).resolves.toBeDefined();
  });

  it("reports when the project has no client", async () => {
    const { project, ctx } = await setup();

    await expect(svc.revokeProjectClient(ctx, project.id)).rejects.toMatchObject({
      code: "no_client",
    });
  });

  it("does not touch projects from another tenant", async () => {
    const a = await setup();
    const b = await setup();
    await svc.createProjectClient(a.ctx, a.project.id, validInput);

    await expect(svc.revokeProjectClient(b.ctx, a.project.id)).rejects.toMatchObject({
      code: "no_client",
    });
    expect(await findUser(validInput.email)).toBeDefined();
  });

  it("is admin only", async () => {
    const { project, ctx } = await setup();

    await expect(
      svc.revokeProjectClient({ ...ctx, role: "viewer" }, project.id),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});
