import bcrypt from "bcryptjs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, projectActivityLog, projects, users } from "@repo/db";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { signInAs } from "../../test/session";
import {
  createProjectClientAction,
  resetProjectClientPasswordAction,
  revokeProjectClientAction,
} from "./project-client";

vi.mock("../../auth", async () => (await import("../../test/session")).authMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const clientForm = () =>
  form({ name: "Ana García", email: "Ana@Example.com", password: "client-pass" });

async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const project = await createTestProject(tenant.id);
  signInAs({ id: admin.id, tenantId: tenant.id, role: "admin" });
  return { tenant, admin, project };
}

async function activityFor(projectId: string) {
  return db.query.projectActivityLog.findMany({
    where: eq(projectActivityLog.projectId, projectId),
  });
}

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
});

describe("createProjectClientAction", () => {
  it("creates and attaches the client, logs activity and revalidates", async () => {
    const { admin, project } = await setup();

    const state = await createProjectClientAction(project.id, null, clientForm());

    expect(state).toEqual({ success: true });
    const client = await db.query.users.findFirst({ where: eq(users.email, "ana@example.com") });
    expect(client?.role).toBe("client");
    const updated = await db.query.projects.findFirst({ where: eq(projects.id, project.id) });
    expect(updated?.clientUserId).toBe(client!.id);
    expect(await activityFor(project.id)).toEqual([
      expect.objectContaining({
        userId: admin.id,
        action: "client_access_granted",
        detail: "Acceso a la app concedido a ana@example.com",
      }),
    ]);
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`);
  });

  it("returns validation errors without side effects", async () => {
    const { project } = await setup();

    const state = await createProjectClientAction(
      project.id,
      null,
      form({ name: "Ana", email: "ana@example.com", password: "short" }),
    );

    expect(state).toEqual({ error: "password_too_short" });
    expect(await activityFor(project.id)).toHaveLength(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("treats missing form fields as empty", async () => {
    const { project } = await setup();

    expect(await createProjectClientAction(project.id, null, new FormData())).toEqual({
      error: "missing_fields",
    });
  });

  it("cannot reach a project in another tenant", async () => {
    await setup();
    const other = await createTestTenant();
    const foreignProject = await createTestProject(other.id);

    expect(await createProjectClientAction(foreignProject.id, null, clientForm())).toEqual({
      error: "project_not_found",
    });
  });

  it.each(["manager", "viewer", "client"] as const)("rejects %s users", async (role) => {
    const { tenant, project } = await setup();
    signInAs({ id: "someone", tenantId: tenant.id, role });

    await expect(createProjectClientAction(project.id, null, clientForm())).rejects.toThrow(
      "Unauthorized",
    );
  });

  it("rejects anonymous requests", async () => {
    const { project } = await setup();
    signInAs(null);

    await expect(createProjectClientAction(project.id, null, clientForm())).rejects.toThrow(
      "Unauthorized",
    );
  });
});

describe("resetProjectClientPasswordAction", () => {
  it("updates the password and logs activity", async () => {
    const { project } = await setup();
    await createProjectClientAction(project.id, null, clientForm());

    const state = await resetProjectClientPasswordAction(
      project.id,
      null,
      form({ password: "brand-new-pass" }),
    );

    expect(state).toEqual({ success: true });
    const client = await db.query.users.findFirst({ where: eq(users.email, "ana@example.com") });
    expect(await bcrypt.compare("brand-new-pass", client!.passwordHash!)).toBe(true);
    expect((await activityFor(project.id)).map((a) => a.action)).toContain("client_password_reset");
  });

  it("reports a project without a client", async () => {
    const { project } = await setup();

    expect(
      await resetProjectClientPasswordAction(project.id, null, form({ password: "brand-new-pass" })),
    ).toEqual({ error: "no_client" });
  });

  it("rejects non-admins", async () => {
    const { tenant, project } = await setup();
    signInAs({ id: "someone", tenantId: tenant.id, role: "manager" });

    await expect(
      resetProjectClientPasswordAction(project.id, null, form({ password: "brand-new-pass" })),
    ).rejects.toThrow("Unauthorized");
  });
});

describe("revokeProjectClientAction", () => {
  it("deletes the client and logs activity", async () => {
    const { project } = await setup();
    await createProjectClientAction(project.id, null, clientForm());

    expect(await revokeProjectClientAction(project.id)).toEqual({ success: true });

    expect(await db.query.users.findFirst({ where: eq(users.email, "ana@example.com") })).toBeUndefined();
    expect((await activityFor(project.id)).map((a) => a.action)).toContain("client_access_revoked");
  });

  it("reports a project without a client", async () => {
    const { project } = await setup();

    expect(await revokeProjectClientAction(project.id)).toEqual({ error: "no_client" });
  });

  it("rejects non-admins", async () => {
    const { tenant, project } = await setup();
    signInAs({ id: "someone", tenantId: tenant.id, role: "viewer" });

    await expect(revokeProjectClientAction(project.id)).rejects.toThrow("Unauthorized");
  });
});
