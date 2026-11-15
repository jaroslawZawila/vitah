import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, projects, tenants } from "@repo/db";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { signInAs } from "../../test/session";
import { NOT_FOUND, TO_FORBIDDEN, TO_LOGIN } from "../../test/navigation";
import { getOfficeContact, getSiteManager, setSiteManagerAction, updateOfficeContactAction } from "./contact";

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

async function setup(role: "admin" | "manager" | "viewer" = "admin") {
  const tenant = await createTestTenant();
  const user = await createTestUser(tenant.id, { role, name: "Javier Ruiz" });
  const project = await createTestProject(tenant.id);
  signInAs({ tenantId: tenant.id, userId: user.id, role });
  return { tenant, user, project };
}

const siteManagerOf = async (projectId: string) =>
  (await db.query.projects.findFirst({ where: eq(projects.id, projectId) }))?.siteManagerUserId;

beforeEach(async () => {
  await resetDatabase();
  vi.mocked(revalidatePath).mockClear();
});

describe("the project's site manager", () => {
  it("is set and cleared by a manager, refreshing the project", async () => {
    const { user, project } = await setup("manager");

    expect(await setSiteManagerAction(project.id, null, form({ userId: user.id }))).toEqual({ success: true });
    expect(await siteManagerOf(project.id)).toBe(user.id);
    expect(revalidatePath).toHaveBeenCalledWith(`/dashboard/projects/${project.id}`, "layout");
    expect((await getSiteManager(project.id))?.siteManager?.id).toBe(user.id);

    expect(await setSiteManagerAction(project.id, null, form({ userId: "" }))).toEqual({ success: true });
    expect(await siteManagerOf(project.id)).toBeNull();
  });

  it("answers the service's refusals as codes", async () => {
    const { tenant, project } = await setup();
    const client = await createTestUser(tenant.id, { role: "client" });

    expect(await setSiteManagerAction(project.id, null, form({ userId: client.id }))).toEqual({ error: "user_not_found" });
    // Signed in to another tenant: their project isn't there.
    await setup();
    expect(await setSiteManagerAction(project.id, null, form({ userId: "" }))).toEqual({ error: "project_not_found" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("is not a viewer's: \"No tienes permiso\" to read, `forbidden` to set; the login page signed out", async () => {
    const { user, project } = await setup("viewer");

    await expect(getSiteManager(project.id)).rejects.toEqual(TO_FORBIDDEN);
    expect(await setSiteManagerAction(project.id, null, form({ userId: user.id }))).toEqual({ error: "forbidden" });
    signInAs(null);
    await expect(setSiteManagerAction(project.id, null, form({ userId: user.id }))).rejects.toEqual(TO_LOGIN);
  });

  it("is \"No encontrado\" for another tenant's project", async () => {
    const { project } = await setup();
    await setup();

    await expect(getSiteManager(project.id)).rejects.toEqual(NOT_FOUND);
  });
});

describe("the office", () => {
  const office = { address: "Camargo, Cantabria", phone: "942 000 000", email: "hola@example.com", hours: "9:00 – 18:00" };

  it("is read and saved by an admin, refreshing its page", async () => {
    const { tenant } = await setup();

    expect(await getOfficeContact()).toEqual({ address: null, phone: null, email: null, hours: null });
    expect(await updateOfficeContactAction(null, form(office))).toEqual({ success: true });
    expect(await getOfficeContact()).toEqual(office);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/contacto");
    const [row] = await db.select({ email: tenants.officeEmail }).from(tenants).where(eq(tenants.id, tenant.id));
    expect(row?.email).toBe("hola@example.com");
  });

  it("refuses a bad email, and anyone but an admin", async () => {
    const { tenant, user } = await setup();

    expect(await updateOfficeContactAction(null, form({ ...office, email: "nope" }))).toEqual({ error: "invalid_email" });
    signInAs({ tenantId: tenant.id, userId: user.id, role: "manager" });
    await expect(getOfficeContact()).rejects.toEqual(TO_FORBIDDEN);
    expect(await updateOfficeContactAction(null, form(office))).toEqual({ error: "forbidden" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
