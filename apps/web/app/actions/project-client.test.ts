import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, projects, users } from "@repo/db";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { signInAs } from "../../test/session";
import {
  createProjectClientAction,
  resetProjectClientPasswordAction,
  revokeProjectClientAction,
} from "./project-client";

// The service itself is covered in packages/core; these tests cover the
// adapter: session → core → `{ error }` / revalidation.

vi.mock("@repo/auth/context", async () => (await import("../../test/session")).sessionMock);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const { revalidatePath } = await import("next/cache");

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const clientForm = () =>
  form({ name: "Ana García", email: "ana@example.com", password: "client-pass" });

async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const project = await createTestProject(tenant.id);
  signInAs({ tenantId: tenant.id, userId: admin.id, role: "admin" });
  return { tenant, admin, project };
}

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
});

describe("client access actions", () => {
  it("grants access and revalidates the project page", async () => {
    const { project } = await setup();

    expect(await createProjectClientAction(project.id, null, clientForm())).toEqual({
      success: true,
    });

    const client = await db.query.users.findFirst({ where: eq(users.email, "ana@example.com") });
    const updated = await db.query.projects.findFirst({ where: eq(projects.id, project.id) });
    expect(updated?.clientUserId).toBe(client!.id);
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`);
  });

  it("returns core errors as form state without revalidating", async () => {
    const { project } = await setup();

    expect(
      await createProjectClientAction(
        project.id,
        null,
        form({ name: "Ana", email: "ana@example.com", password: "short" }),
      ),
    ).toEqual({ error: "password_too_short" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("returns forbidden for non-admins", async () => {
    const { tenant, admin, project } = await setup();
    signInAs({ tenantId: tenant.id, userId: admin.id, role: "manager" });

    expect(await createProjectClientAction(project.id, null, clientForm())).toEqual({
      error: "forbidden",
    });
  });

  it("rejects anonymous requests", async () => {
    const { project } = await setup();
    signInAs(null);

    await expect(createProjectClientAction(project.id, null, clientForm())).rejects.toThrow(
      "Unauthorized",
    );
  });

  it("resets the password", async () => {
    const { project } = await setup();
    await createProjectClientAction(project.id, null, clientForm());

    expect(
      await resetProjectClientPasswordAction(project.id, null, form({ password: "brand-new-pass" })),
    ).toEqual({ success: true });
  });

  it("revokes access", async () => {
    const { project } = await setup();
    await createProjectClientAction(project.id, null, clientForm());

    expect(await revokeProjectClientAction(project.id)).toEqual({ success: true });
    expect(await revokeProjectClientAction(project.id)).toEqual({ error: "no_client" });
  });
});
