import { beforeEach, describe, expect, it } from "vitest";
import { db, eq, projects, tenants, users } from "@repo/db";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { contactService as svc, projectsService, usersService, type Ctx } from "../src";

async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin", name: "Ana Admin" });
  const manager = await createTestUser(tenant.id, {
    role: "manager",
    name: "Javier Ruiz",
    email: "javier@example.com",
    phone: "+34 600 111 222",
  });
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, { clientUserId: client.id });
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  return { tenant, admin, manager, client, project, ctx };
}

const as = (ctx: Ctx, role: Ctx["role"]): Ctx => ({ ...ctx, role });

async function siteManagerOf(projectId: string) {
  const [row] = await db.select({ id: projects.siteManagerUserId }).from(projects).where(eq(projects.id, projectId));
  return row?.id;
}

beforeEach(async () => {
  await resetDatabase();
});

describe("a project's site manager", () => {
  it("is picked by an admin or a manager among the tenant's active staff", async () => {
    const { ctx, manager, admin, project } = await setup();

    expect(await svc.setSiteManager(ctx, project.id, { userId: manager.id })).toEqual({
      projectId: project.id,
      userId: manager.id,
    });
    const { siteManager, options } = await svc.getProjectSiteManager(as(ctx, "manager"), project.id);
    expect(siteManager).toEqual({ id: manager.id, name: "Javier Ruiz", email: "javier@example.com", phone: "+34 600 111 222" });
    // Staff only, sorted by name; no clients.
    expect(options.map((o) => o.id)).toEqual([admin.id, manager.id]);

    await svc.setSiteManager(as(ctx, "manager"), project.id, { userId: null });
    expect(await siteManagerOf(project.id)).toBeNull();
    await svc.setSiteManager(ctx, project.id, { userId: manager.id });
    await svc.setSiteManager(ctx, project.id, { userId: "" });
    expect(await siteManagerOf(project.id)).toBeNull();
  });

  it("is not for viewers, neither to read nor to set", async () => {
    const { ctx, manager, project } = await setup();
    const viewer = as(ctx, "viewer");

    await expect(svc.getProjectSiteManager(viewer, project.id)).rejects.toMatchObject({ code: "forbidden", status: 403 });
    await expect(svc.setSiteManager(viewer, project.id, { userId: manager.id })).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses a client, an inactive user, another tenant's user and an unknown id", async () => {
    const { ctx, client, project } = await setup();
    const inactive = await createTestUser(ctx.tenantId, { role: "manager", active: false });
    const other = await createTestTenant();
    const stranger = await createTestUser(other.id, { role: "admin" });

    for (const userId of [client.id, inactive.id, stranger.id, "nope"]) {
      await expect(svc.setSiteManager(ctx, project.id, { userId })).rejects.toMatchObject({
        code: "user_not_found",
        status: 404,
      });
    }
    expect(await siteManagerOf(project.id)).toBeNull();
  });

  it("needs the project first (404), then a userId (400)", async () => {
    const { ctx, manager, project } = await setup();
    const other = await createTestTenant();
    const theirs = await createTestProject(other.id);

    await expect(svc.setSiteManager(ctx, theirs.id, { userId: manager.id })).rejects.toMatchObject({
      code: "project_not_found",
      status: 404,
    });
    await expect(svc.getProjectSiteManager(ctx, theirs.id)).rejects.toMatchObject({ code: "project_not_found" });
    await expect(svc.setSiteManager(ctx, theirs.id, {})).rejects.toMatchObject({ code: "project_not_found" });
    await expect(svc.setSiteManager(ctx, project.id, {})).rejects.toMatchObject({ code: "missing_fields", status: 400 });
    await expect(svc.setSiteManager(ctx, project.id, { userId: 7 })).rejects.toMatchObject({ code: "invalid_input" });
    expect(await siteManagerOf(theirs.id)).toBeNull();
  });

  it("is not set on a deleted project", async () => {
    const { ctx, manager, project } = await setup();
    await projectsService.deleteProject(ctx, project.id);

    await expect(svc.setSiteManager(ctx, project.id, { userId: manager.id })).rejects.toMatchObject({
      code: "project_not_found",
    });
  });

  it("stops being shown once deactivated, and comes back if activated again", async () => {
    const { ctx, manager, project } = await setup();
    await svc.setSiteManager(ctx, project.id, { userId: manager.id });

    await usersService.updateUser(ctx, manager.id, { active: false });
    expect((await svc.getProjectSiteManager(ctx, project.id)).siteManager).toBeNull();

    await usersService.updateUser(ctx, manager.id, { active: true });
    expect((await svc.getProjectSiteManager(ctx, project.id)).siteManager?.id).toBe(manager.id);
  });

  it("empties when the user is deleted", async () => {
    const { ctx, manager, project } = await setup();
    await svc.setSiteManager(ctx, project.id, { userId: manager.id });

    await db.delete(users).where(eq(users.id, manager.id));

    expect(await siteManagerOf(project.id)).toBeNull();
  });
});

describe("the office", () => {
  it("is read by any staff and written by admins only, whole", async () => {
    const { ctx } = await setup();
    const empty = { address: null, phone: null, email: null, hours: null };
    expect(await svc.getOfficeContact(as(ctx, "viewer"))).toEqual(empty);

    const office = await svc.updateOfficeContact(ctx, {
      address: "  Camargo, Cantabria ",
      phone: "942 000 000",
      email: "hola@example.com",
      hours: "Lunes a viernes · 9:00 – 18:00",
      unknown: "dropped",
    });
    expect(office).toEqual({
      address: "Camargo, Cantabria",
      phone: "942 000 000",
      email: "hola@example.com",
      hours: "Lunes a viernes · 9:00 – 18:00",
    });
    expect(await svc.getOfficeContact(as(ctx, "manager"))).toEqual(office);

    // A field not sent, or blank, is cleared.
    expect(await svc.updateOfficeContact(ctx, { address: "Camargo", phone: "" })).toEqual({ ...empty, address: "Camargo" });

    await expect(svc.updateOfficeContact(as(ctx, "manager"), {})).rejects.toMatchObject({ code: "forbidden" });
  });

  it("refuses a bad phone or email, and changes nothing", async () => {
    const { ctx } = await setup();
    await svc.updateOfficeContact(ctx, { address: "Camargo" });

    await expect(svc.updateOfficeContact(ctx, { phone: "call me" })).rejects.toMatchObject({ code: "invalid_phone", status: 400 });
    await expect(svc.updateOfficeContact(ctx, { email: "nope" })).rejects.toMatchObject({ code: "invalid_email" });
    expect((await svc.getOfficeContact(ctx)).address).toBe("Camargo");
  });

  it("is each tenant's own", async () => {
    const { ctx } = await setup();
    const other = await createTestTenant();
    const otherAdmin = await createTestUser(other.id, { role: "admin" });
    await svc.updateOfficeContact(ctx, { address: "Camargo" });

    expect(await svc.getOfficeContact({ tenantId: other.id, userId: otherAdmin.id, role: "admin" })).toMatchObject({
      address: null,
    });
  });
});

describe("getClientContact (the app's Contacto)", () => {
  it("gives the client their home's site manager and the office", async () => {
    const { ctx, tenant, manager, client, project } = await setup();
    await svc.setSiteManager(ctx, project.id, { userId: manager.id });
    await svc.updateOfficeContact(ctx, { address: "Camargo, Cantabria", hours: "9:00 – 18:00" });

    expect(await svc.getClientContact(tenant.id, client.id)).toEqual({
      siteManager: { name: "Javier Ruiz", phone: "+34 600 111 222", email: "javier@example.com" },
      office: { name: tenant.name, address: "Camargo, Cantabria", phone: null, email: null, hours: "9:00 – 18:00" },
    });
  });

  it("is null for each part the builder hasn't given", async () => {
    const { tenant, client } = await setup();

    expect(await svc.getClientContact(tenant.id, client.id)).toEqual({ siteManager: null, office: null });
  });

  it("is the home asked for, and never one that isn't the client's", async () => {
    const { ctx, tenant, manager, admin, client, project } = await setup();
    const second = await createTestProject(tenant.id, { clientUserId: client.id, startDate: new Date("2020-01-01") });
    const someoneElses = await createTestProject(tenant.id);
    await svc.setSiteManager(ctx, project.id, { userId: manager.id });
    await svc.setSiteManager(ctx, second.id, { userId: admin.id });
    await svc.setSiteManager(ctx, someoneElses.id, { userId: manager.id });

    expect((await svc.getClientContact(tenant.id, client.id, second.id)).siteManager?.name).toBe("Ana Admin");
    expect((await svc.getClientContact(tenant.id, client.id, project.id)).siteManager?.name).toBe("Javier Ruiz");
    await expect(svc.getClientContact(tenant.id, client.id, someoneElses.id)).rejects.toMatchObject({
      code: "project_not_found",
      status: 404,
    });
  });

  it("without a home, gives the office only", async () => {
    const { ctx, tenant, manager, project } = await setup();
    await svc.setSiteManager(ctx, project.id, { userId: manager.id });
    await svc.updateOfficeContact(ctx, { phone: "942 000 000" });
    const homeless = await createTestUser(tenant.id, { role: "client" });

    expect(await svc.getClientContact(tenant.id, homeless.id)).toMatchObject({
      siteManager: null,
      office: { phone: "942 000 000" },
    });
  });

  it("drops a site manager who is deactivated, and a deleted project's", async () => {
    const { ctx, tenant, manager, client, project } = await setup();
    await svc.setSiteManager(ctx, project.id, { userId: manager.id });

    await db.update(users).set({ active: false }).where(eq(users.id, manager.id));
    expect((await svc.getClientContact(tenant.id, client.id)).siteManager).toBeNull();

    await db.update(users).set({ active: true }).where(eq(users.id, manager.id));
    await projectsService.deleteProject(ctx, project.id);
    expect((await svc.getClientContact(tenant.id, client.id)).siteManager).toBeNull();
  });

  it("never shows another tenant's user or office, whatever the stored pointer says", async () => {
    const { tenant, client, project } = await setup();
    const other = await createTestTenant();
    const stranger = await createTestUser(other.id, { role: "admin", phone: "+34 699 999 999" });
    await db.update(tenants).set({ officePhone: "999 999 999" }).where(eq(tenants.id, other.id));
    // Only a hand-written row could do this: the service refuses it.
    await db.update(projects).set({ siteManagerUserId: stranger.id }).where(eq(projects.id, project.id));

    expect(await svc.getClientContact(tenant.id, client.id)).toEqual({ siteManager: null, office: null });
  });

  it("names the site manager by their email when they have no name", async () => {
    const { ctx, tenant, client, project } = await setup();
    const nameless = await createTestUser(tenant.id, { role: "viewer", email: "obra@example.com" });
    await db.update(users).set({ name: null }).where(eq(users.id, nameless.id));
    await svc.setSiteManager(ctx, project.id, { userId: nameless.id });

    expect((await svc.getClientContact(tenant.id, client.id)).siteManager).toEqual({
      name: "obra@example.com",
      phone: null,
      email: "obra@example.com",
    });
  });
});

describe("a staff user's phone", () => {
  it("is set when created and changed or cleared by an admin", async () => {
    const { ctx } = await setup();
    const { id } = await usersService.createUser(ctx, {
      email: "nuevo@example.com",
      name: "Nuevo",
      password: "Password1234",
      role: "manager",
      phone: " 600 000 000 ",
    });
    const phoneOf = async () => (await usersService.listUsers(ctx)).find((u) => u.id === id)?.phone;
    expect(await phoneOf()).toBe("600 000 000");

    await usersService.updateUser(ctx, id, { role: "viewer" });
    expect(await phoneOf()).toBe("600 000 000");
    await usersService.updateUser(ctx, id, { phone: "+34 611 222 333" });
    expect(await phoneOf()).toBe("+34 611 222 333");
    await usersService.updateUser(ctx, id, { phone: null });
    expect(await phoneOf()).toBeNull();
  });

  it("refuses a bad phone, after the other checks of a new user", async () => {
    const { ctx, manager } = await setup();
    const base = { email: "x@example.com", name: "X", password: "Password1234", role: "viewer" };

    await expect(usersService.createUser(ctx, { ...base, phone: "abc" })).rejects.toMatchObject({ code: "invalid_phone" });
    await expect(usersService.createUser(ctx, { ...base, name: "", phone: "abc" })).rejects.toMatchObject({
      code: "missing_fields",
    });
    await expect(usersService.updateUser(ctx, manager.id, { phone: "abc" })).rejects.toMatchObject({
      code: "invalid_phone",
    });
    await expect(usersService.updateUser(as(ctx, "manager"), manager.id, { phone: "600 000 000" })).rejects.toMatchObject({
      code: "forbidden",
    });
  });
});
