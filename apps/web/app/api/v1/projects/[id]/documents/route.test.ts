import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { createMobileToken } from "@repo/auth/mobile";
import { MAX_DOCUMENT_BYTES } from "@repo/core/contract";
import { files } from "@repo/core/testing";
import { GET as list, POST } from "./route";
import { DELETE, GET as download } from "./[documentId]/route";

// Bearer requests never read the NextAuth session, and next-auth itself
// can't load outside Next.js.
vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

async function staffToken(tenantId: string, role: "manager" | "viewer" = "manager") {
  const user = await createTestUser(tenantId, { role });
  return createMobileToken({ sub: user.id, email: user.email, name: user.name, role, tenantId });
}

function request(token: string, init: { method?: string; body?: BodyInit } = {}) {
  return new Request("http://localhost/api/v1/projects/x/documents", {
    method: init.method ?? "GET",
    headers: { Authorization: `Bearer ${token}` },
    body: init.body,
  });
}

function upload(projectId: string, token: string, file: File) {
  const body = new FormData();
  body.set("title", "Planos");
  body.set("category", "plans");
  body.set("file", file);
  return POST(request(token, { method: "POST", body }), projectParams(projectId));
}

const pdf = new File(["%PDF-1.7\nplanos"], "planos.pdf", { type: "application/pdf" });
const projectParams = (id: string) => ({ params: Promise.resolve({ id }) });
const params = (id: string, documentId: string) => ({
  params: Promise.resolve({ id, documentId }),
});

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("/api/v1/projects/:id/documents", () => {
  it("uploads, lists, downloads and deletes a document", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);
    const token = await staffToken(tenant.id);

    const created = await upload(project.id, token, pdf);
    expect(created.status).toBe(201);
    const { documentId } = await created.json();

    const listed = await list(request(token), projectParams(project.id));
    expect(await listed.json()).toEqual([
      expect.objectContaining({ id: documentId, title: "Planos", category: "plans" }),
    ]);

    const file = await download(request(token), params(project.id, documentId));
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(file.headers.get("content-disposition")).toBe(
      "inline; filename*=UTF-8''Planos.pdf",
    );
    expect(file.headers.get("cache-control")).toBe("private, no-store");
    expect(await file.text()).toBe("%PDF-1.7\nplanos");

    const deleted = await DELETE(request(token, { method: "DELETE" }), params(project.id, documentId));
    expect(deleted.status).toBe(204);
    expect(files.size).toBe(0);
  });

  it("returns core errors as JSON", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);

    const tooLarge = await upload(
      project.id,
      await staffToken(tenant.id),
      new File(["%PDF-", new Uint8Array(MAX_DOCUMENT_BYTES)], "big.pdf"),
    );
    expect(tooLarge.status).toBe(413);
    expect(await tooLarge.json()).toEqual({ error: "file_too_large" });

    const viewer = await upload(project.id, await staffToken(tenant.id, "viewer"), pdf);
    expect(viewer.status).toBe(403);

    const badBody = await POST(
      request(await staffToken(tenant.id), { method: "POST", body: "not a form" }),
      projectParams(project.id),
    );
    expect(badBody.status).toBe(400);
    expect(await badBody.json()).toEqual({ error: "invalid_body" });
  });

  it("hides other tenants' documents", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id);
    const { documentId } = await (await upload(project.id, await staffToken(tenant.id), pdf)).json();
    const outsider = await staffToken((await createTestTenant()).id);

    const file = await download(request(outsider), params(project.id, documentId));
    expect(file.status).toBe(404);

    const listed = await list(request(outsider), projectParams(project.id));
    expect(listed.status).toBe(404);
  });

  it("requires authentication", async () => {
    const res = await list(new Request("http://localhost/api/v1/projects/x/documents"), projectParams("x"));
    expect(res.status).toBe(401);
  });
});
