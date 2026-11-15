import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { contactService, type Ctx } from "@repo/core";
import { db, eq, users } from "@repo/db";
import { clientToken, staffToken } from "../../../../test/api";
import { GET } from "./route";

// lib/api also serves /api/v1, which can read the NextAuth session; next-auth
// itself can't load outside Next.js.
vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

const get = (token: string | null, projectId?: string) =>
  GET(
    new Request(`http://localhost/api/mobile/contact${projectId ? `?projectId=${projectId}` : ""}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    }),
  );

async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  const manager = await createTestUser(tenant.id, {
    role: "manager",
    name: "Javier Ruiz",
    email: "javier@example.com",
    phone: "+34 600 111 222",
  });
  const client = await createTestUser(tenant.id, { role: "client", email: "ana@example.com" });
  const project = await createTestProject(tenant.id, { clientUserId: client.id });
  const token = await clientToken(tenant.id, client.id, client.email);
  return { tenant, ctx, manager, client, project, token };
}

beforeEach(async () => {
  await resetDatabase();
});

describe("GET /api/mobile/contact", () => {
  it("returns the home's site manager and the office", async () => {
    const { tenant, ctx, manager, project, token } = await setup();
    await contactService.setSiteManager(ctx, project.id, { userId: manager.id });
    await contactService.updateOfficeContact(ctx, { address: "Camargo, Cantabria", email: "hola@example.com" });

    const res = await get(token);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      siteManager: { name: "Javier Ruiz", phone: "+34 600 111 222", email: "javier@example.com" },
      office: { name: tenant.name, address: "Camargo, Cantabria", phone: null, email: "hola@example.com", hours: null },
    });
  });

  it("returns nulls when the builder has given nothing yet", async () => {
    const { token } = await setup();

    expect(await (await get(token)).json()).toEqual({ siteManager: null, office: null });
  });

  it("returns the home asked for, and 404 for one that isn't the client's", async () => {
    const { tenant, ctx, manager, client, project, token } = await setup();
    const other = await createTestProject(tenant.id, { clientUserId: client.id, startDate: new Date("2020-01-01") });
    const someoneElses = await createTestProject(tenant.id);
    await contactService.setSiteManager(ctx, project.id, { userId: manager.id });

    expect((await (await get(token, project.id)).json()).siteManager.name).toBe("Javier Ruiz");
    expect((await (await get(token, other.id)).json()).siteManager).toBeNull();
    const res = await get(token, someoneElses.id);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "project_not_found" });
  });

  it("never shows another tenant's home", async () => {
    const { token } = await setup();
    const other = await createTestTenant();
    const theirs = await createTestProject(other.id);

    expect((await get(token, theirs.id)).status).toBe(404);
  });

  it("stops showing a site manager once deactivated", async () => {
    const { ctx, manager, project, token } = await setup();
    await contactService.setSiteManager(ctx, project.id, { userId: manager.id });

    await db.update(users).set({ active: false }).where(eq(users.id, manager.id));

    expect((await (await get(token)).json()).siteManager).toBeNull();
  });

  it("returns 401 without a token, or with a staff one", async () => {
    const { tenant } = await setup();
    const { token } = await staffToken(tenant.id, "admin");

    expect((await get(null)).status).toBe(401);
    expect((await get(token)).status).toBe(401);
  });
});
