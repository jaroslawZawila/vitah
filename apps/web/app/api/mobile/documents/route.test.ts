import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { createMobileToken } from "@repo/auth/mobile";
import { db, eq, users } from "@repo/db";
import { documentsService, type Ctx } from "@repo/core";
import { files } from "@repo/core/testing";
import { GET as list } from "./route";
import { GET as download } from "./[id]/route";

// lib/api also serves /api/v1, which can read the NextAuth session; next-auth
// itself can't load outside Next.js.
vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

const pdf = () => new File(["%PDF-1.7\ncontrato"], "c.pdf", { type: "application/pdf" });

function request(token?: string) {
  return new Request("http://localhost/api/mobile/documents", {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

/** A project with a client and one uploaded document. */
async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, { clientUserId: client.id });
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  const { documentId } = await documentsService.addDocument(ctx, project.id, {
    title: "Contrato",
    category: "contract",
    file: pdf(),
  });
  const token = await createMobileToken({
    sub: client.id,
    email: client.email,
    name: client.name,
    role: "client",
    tenantId: tenant.id,
  });
  return { client, documentId, token };
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("GET /api/mobile/documents", () => {
  it("lists the client's documents", async () => {
    const { documentId, token } = await setup();
    await setup(); // another client's document

    const res = await list(request(token));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      documents: [
        {
          id: documentId,
          title: "Contrato",
          category: "contract",
          sizeBytes: pdf().size,
          uploadedAt: expect.any(String),
        },
      ],
    });
  });

  it("requires a valid token", async () => {
    expect((await list(request())).status).toBe(401);
    expect((await list(request("garbage"))).status).toBe(401);
  });

  it("rejects deactivated clients", async () => {
    const { client, token } = await setup();
    await db.update(users).set({ active: false }).where(eq(users.id, client.id));

    expect((await list(request(token))).status).toBe(401);
  });
});

describe("GET /api/mobile/documents/:id", () => {
  it("streams the client's own document", async () => {
    const { documentId, token } = await setup();

    const res = await download(request(token), { params: Promise.resolve({ id: documentId }) });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(await res.text()).toBe("%PDF-1.7\ncontrato");
  });

  it("returns 404 for another client's document", async () => {
    const { token } = await setup();
    const other = await setup();

    const res = await download(request(token), {
      params: Promise.resolve({ id: other.documentId }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "not_found" });
  });
});
