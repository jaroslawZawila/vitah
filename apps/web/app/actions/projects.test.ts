import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, projects } from "@repo/db";
import {
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { signInAs } from "../../test/session";
import {
  createProject,
  deleteProject,
  getProject,
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

  it("returns nothing without a session", async () => {
    const { tenant } = await setup();
    const project = await createTestProject(tenant.id);
    signInAs(null);

    expect(await getProjects()).toEqual([]);
    expect(await getProject(project.id)).toBeNull();
    await expect(
      createProject({ ref: "VTH-1", address: "Calle 1" }),
    ).rejects.toThrow("Unauthorized");
    await expect(updateProject(project.id, { address: "X" })).rejects.toThrow(
      "Unauthorized",
    );
    await expect(deleteProject(project.id)).rejects.toThrow("Unauthorized");
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

  it("deletes a project", async () => {
    const { tenant } = await setup();
    const project = await createTestProject(tenant.id);

    await deleteProject(project.id);

    expect(await reload(project.id)).toBeUndefined();
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/projects");
  });
});
