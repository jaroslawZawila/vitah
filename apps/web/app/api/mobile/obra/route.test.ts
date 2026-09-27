import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { createMobileToken } from "@repo/auth/mobile";
import { db, eq, projects } from "@repo/db";
import { files } from "@repo/core/testing";
import { routeParams, seededObraProject } from "../../../../test/api";
import { GET } from "./route";
import { GET as getFile } from "./hitos/[id]/[kind]/route";

// lib/api also serves /api/v1, which can read the NextAuth session; next-auth
// itself can't load outside Next.js.
vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

const request = (token?: string) =>
  new Request("http://localhost/api/mobile/obra", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

async function clientToken(tenantId: string, userId: string, email: string) {
  return createMobileToken({ sub: userId, email, name: null, role: "client", tenantId });
}

/** The seeded Castrillón project with a client attached. */
async function setup() {
  const { tenant, project } = await seededObraProject();
  const client = await createTestUser(tenant.id, { role: "client" });
  await db.update(projects).set({ clientUserId: client.id }).where(eq(projects.id, project.id));
  return { tenant, project, client, token: await clientToken(tenant.id, client.id, client.email) };
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("GET /api/mobile/obra", () => {
  it("gives the client's obra: phases, hitos and progress", async () => {
    const { token } = await setup();

    const res = await GET(request(token));

    expect(res.status).toBe(200);
    const { obra } = await res.json();
    expect(obra).toMatchObject({ stage: 6, progressPct: 52 });
    expect(obra.phases.map((p: { key: string }) => p.key)).toEqual(["pre", "H2", "H3", "H4", "H5", "H6", "H7", "H8", "H9"]);
    expect(obra.hitos).toHaveLength(10);
  });

  it("is null without a project", async () => {
    const tenant = await createTestTenant();
    const lonely = await createTestUser(tenant.id, { role: "client" });
    const res = await GET(request(await clientToken(tenant.id, lonely.id, lonely.email)));
    expect(await res.json()).toEqual({ obra: null });
  });

  it("needs a client token", async () => {
    expect((await GET(request())).status).toBe(401);
  });
});

describe("GET /api/mobile/obra/hitos/:id/:kind", () => {
  it("serves the client's own acta and invoice only", async () => {
    const { token } = await setup();
    const h3 = (await (await GET(request(token))).json()).obra.hitos.find((h: { code: string }) => h.code === "H3");

    const invoice = await getFile(request(token), routeParams({ id: h3.id, kind: "invoice" }));
    expect(invoice.status).toBe(200);
    expect(invoice.headers.get("Content-Type")).toBe("application/pdf");
    expect(await invoice.text()).toContain("%PDF-");
    expect((await getFile(request(token), routeParams({ id: h3.id, kind: "receipt" }))).status).toBe(404);

    const other = await setup();
    expect((await getFile(request(other.token), routeParams({ id: h3.id, kind: "invoice" }))).status).toBe(404);
  });
});
