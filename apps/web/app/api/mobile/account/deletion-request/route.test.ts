import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { db, eq, users } from "@repo/db";
import { apiRequest, clientToken, staffToken } from "../../../../../test/api";
import { GET as settings } from "../../settings/route";
import { DELETE, POST } from "./route";

// lib/api also serves /api/v1, which can read the NextAuth session; next-auth
// itself can't load outside Next.js.
vi.mock("@repo/auth", () => ({ auth: vi.fn() }));

beforeEach(resetDatabase);

async function client(tenantId: string, options: { active?: boolean } = {}) {
  const user = await createTestUser(tenantId, { role: "client", ...options });
  return { user, token: await clientToken(tenantId, user.id, user.email) };
}

const requestedAt = async (userId: string) =>
  (await db.query.users.findFirst({ where: eq(users.id, userId) }))!.deletionRequestedAt;

describe("/api/mobile/account/deletion-request", () => {
  it("asks, keeps the first date when asked again, shows it in settings, and withdraws", async () => {
    const tenant = await createTestTenant();
    const { user, token } = await client(tenant.id);

    const asked = await POST(apiRequest(token, { method: "POST" }));
    expect(asked.status).toBe(200);
    const { deletionRequestedAt } = await asked.json();
    expect(deletionRequestedAt).toEqual(expect.any(String));

    expect(await (await POST(apiRequest(token, { method: "POST" }))).json()).toEqual({ deletionRequestedAt });
    expect(await (await settings(apiRequest(token))).json()).toEqual({
      notifications: { progress: true, documents: true, messages: true },
      deletionRequestedAt,
    });

    const withdrawn = await DELETE(apiRequest(token, { method: "DELETE" }));
    expect(withdrawn.status).toBe(200);
    expect(await withdrawn.json()).toEqual({ deletionRequestedAt: null });
    expect(await requestedAt(user.id)).toBeNull();
  });

  it("only ever touches the caller's own account", async () => {
    const tenant = await createTestTenant();
    const ana = await client(tenant.id);
    const luis = await client(tenant.id);
    const elsewhere = await client((await createTestTenant()).id);
    await POST(apiRequest(ana.token, { method: "POST" }));

    // Another client of the same builder, and of another, withdraw their own (none).
    expect((await DELETE(apiRequest(luis.token, { method: "DELETE" }))).status).toBe(200);
    expect((await DELETE(apiRequest(elsewhere.token, { method: "DELETE" }))).status).toBe(200);
    await POST(apiRequest(luis.token, { method: "POST" }));

    expect(await requestedAt(ana.user.id)).not.toBeNull();
    expect(await requestedAt(luis.user.id)).not.toBeNull();
    expect(await requestedAt(elsewhere.user.id)).toBeNull();
  });

  it("refuses a deactivated client, staff and no token", async () => {
    const tenant = await createTestTenant();
    const gone = await client(tenant.id, { active: false });
    const { token: staff, user: admin } = await staffToken(tenant.id, "admin");

    expect((await POST(apiRequest(gone.token, { method: "POST" }))).status).toBe(401);
    expect((await DELETE(apiRequest(gone.token, { method: "DELETE" }))).status).toBe(401);
    expect((await POST(apiRequest(staff, { method: "POST" }))).status).toBe(401);
    expect((await POST(apiRequest(null, { method: "POST" }))).status).toBe(401);
    expect(await requestedAt(gone.user.id)).toBeNull();
    expect(await requestedAt(admin.id)).toBeNull();
  });
});
