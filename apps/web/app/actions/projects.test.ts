import { beforeEach, describe, expect, it, vi } from "vitest";
import { budgetRevisions, db, eq, projects } from "@repo/db";
import {
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { signInAs } from "../../test/session";
import { NOT_FOUND, TO_LOGIN } from "../../test/navigation";
import {
  createProject,
  deleteProject,
  getProject,
  getProjectList,
  getProjects,
  updateProject,
} from "./projects";

// The service itself is covered in packages/core; these tests cover the
// adapter: session → core → `{ error }` / revalidation.

vi.mock(
  "@repo/auth/context",
  async () => (await import("../../test/session")).sessionMock,
);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

async function setup() {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role: "manager" });
  signInAs({ tenantId: tenant.id, userId: user.id, role: "manager" });
  return { tenant };
}

const reload = (id: string) =>
  db.query.projects.findFirst({ where: eq(projects.id, id) });

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
});

describe("project actions", () => {
  it("lists and reads the tenant's projects", async () => {
    const { tenant } = await setup();
    const project = await createTestProject(tenant.id);

    expect((await getProjects()).map((p) => p.id)).toEqual([project.id]);
    expect(await getProject(project.id)).toMatchObject({ id: project.id });
  });

  it("lists the tenant's projects with each budget's state, never another tenant's", async () => {
    const other = await createTestTenant();
    await createTestProject(other.id, { ref: "VTH-9" });
    const { tenant } = await setup();
    const project = await createTestProject(tenant.id);

    expect(await getProjectList()).toEqual([
      expect.objectContaining({ id: project.id, budget: { revision: null, generation: null } }),
    ]);
  });

  it("lists nothing only when the tenant has no projects", async () => {
    const other = await createTestTenant();
    await createTestProject(other.id);
    await setup();

    expect(await getProjects()).toEqual([]);
    expect(await getProjectList()).toEqual([]);
  });

  it("is \"No encontrado\" for a project that isn't the tenant's or isn't there, never null", async () => {
    const other = await createTestTenant();
    const theirs = await createTestProject(other.id);
    await setup();

    await expect(getProject(theirs.id)).rejects.toEqual(NOT_FOUND);
    await expect(getProject("no-such-project")).rejects.toEqual(NOT_FOUND);
  });

  it("goes to the login page without a session, reads and writes alike", async () => {
    const { tenant } = await setup();
    const project = await createTestProject(tenant.id);
    signInAs(null);

    await expect(getProjects()).rejects.toEqual(TO_LOGIN);
    await expect(getProjectList()).rejects.toEqual(TO_LOGIN);
    await expect(getProject(project.id)).rejects.toEqual(TO_LOGIN);
    // A write whose session ended sends the browser to the login page.
    await expect(createProject({ ref: "VTH-1", address: "Calle 1" })).rejects.toEqual(TO_LOGIN);
    await expect(updateProject(project.id, { address: "X" })).rejects.toEqual(TO_LOGIN);
    await expect(deleteProject(project.id)).rejects.toEqual(TO_LOGIN);
  });

  it("creates a project from the wizard draft and revalidates the list", async () => {
    await setup();

    const result = await createProject({
      ref: "VTH-1",
      address: "Calle 1",
      startDate: "2026-03-01",
      completionDate: "",
    });

    expect(result).toEqual({ success: true, id: expect.any(String) });
    expect(await reload(result!.id!)).toMatchObject({
      ref: "VTH-1",
      address: "Calle 1",
      startDate: new Date("2026-03-01"),
      completionDate: null,
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/projects");
  });

  it("returns core errors as form state", async () => {
    await setup();

    expect(await createProject({ ref: "VTH-1" })).toEqual({
      error: "missing_fields",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("updates a project and revalidates both pages", async () => {
    const { tenant } = await setup();
    const project = await createTestProject(tenant.id);

    expect(
      await updateProject(project.id, { address: "Calle Nueva 2" }),
    ).toEqual({ success: true });
    expect((await reload(project.id))?.address).toBe("Calle Nueva 2");
    expect(revalidatePath).toHaveBeenCalledWith(
      `/dashboard/projects/${project.id}`,
    );
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/projects");
  });

  it("returns update errors as state, including other tenants' projects", async () => {
    await setup();
    const foreign = await createTestProject((await createTestTenant()).id);

    expect(await updateProject(foreign.id, { address: "Hacked" })).toEqual({
      error: "not_found",
    });
    expect(await updateProject(foreign.id, { startDate: "nope" })).toEqual({
      error: "invalid_date",
    });
  });

  it("lets an admin delete a project", async () => {
    const { tenant } = await setup();
    const admin = await createTestUser(tenant.id, { role: "admin" });
    signInAs({ tenantId: tenant.id, userId: admin.id, role: "admin" });
    const project = await createTestProject(tenant.id);

    const other = await createTestProject(tenant.id);

    expect(await deleteProject(project.id)).toEqual({ success: true });

    // Archived, not erased: the row stays, marked with who deleted it.
    expect(await reload(project.id)).toMatchObject({ id: project.id, deletedAt: expect.any(Date), deletedById: admin.id });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/projects");
    // And it is gone from the portal.
    await expect(getProject(project.id)).rejects.toEqual(NOT_FOUND);
    expect((await getProjects()).map((p) => p.id)).toEqual([other.id]);
    expect((await getProjectList()).map((p) => p.id)).toEqual([other.id]);
    expect(await updateProject(project.id, { address: "Otra" })).toEqual({ error: "not_found" });
  });

  it("deletes a project whatever it holds, keeping its records, and answers not_found the second time", async () => {
    const { tenant } = await setup();
    const admin = await createTestUser(tenant.id, { role: "admin" });
    signInAs({ tenantId: tenant.id, userId: admin.id, role: "admin" });
    const project = await createTestProject(tenant.id);
    await db.insert(budgetRevisions).values({ tenantId: tenant.id, projectId: project.id, number: 0, status: "accepted" });

    expect(await deleteProject(project.id)).toEqual({ success: true });

    expect(await db.select().from(budgetRevisions).where(eq(budgetRevisions.projectId, project.id))).toHaveLength(1);
    vi.mocked(revalidatePath).mockClear();
    expect(await deleteProject(project.id)).toEqual({ error: "not_found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses to delete for a manager, or another tenant's project", async () => {
    const { tenant } = await setup();
    const project = await createTestProject(tenant.id);

    expect(await deleteProject(project.id)).toEqual({ error: "forbidden" });
    expect((await reload(project.id))?.deletedAt).toBeNull();

    const admin = await createTestUser(tenant.id, { role: "admin" });
    signInAs({ tenantId: tenant.id, userId: admin.id, role: "admin" });
    const foreign = await createTestProject((await createTestTenant()).id);

    expect(await deleteProject(foreign.id)).toEqual({ error: "not_found" });
    expect((await reload(foreign.id))?.deletedAt).toBeNull();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("refuses changes from a viewer", async () => {
    const { tenant } = await setup();
    const viewer = await createTestUser(tenant.id, { role: "viewer" });
    signInAs({ tenantId: tenant.id, userId: viewer.id, role: "viewer" });
    const project = await createTestProject(tenant.id, { address: "Calle 1" });

    expect(await createProject({ ref: "VTH-9", address: "Calle 9" })).toEqual({
      error: "forbidden",
    });
    expect(await updateProject(project.id, { address: "Hacked" })).toEqual({
      error: "forbidden",
    });
    expect(await deleteProject(project.id)).toEqual({ error: "forbidden" });
    expect(await reload(project.id)).toMatchObject({ address: "Calle 1", deletedAt: null });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
