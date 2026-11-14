import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDocument, createTestPhoto, createTestProject, createTestTenant, resetDatabase } from "@repo/db/testing";
import { documentsService, photosService, projectsService, type Ctx } from "@repo/core";
import { apiRequest, routeParams, staffToken } from "../../../../test/api";
import { GET as list } from "./route";
import { POST as restore } from "./[kind]/[id]/restore/route";

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

beforeEach(resetDatabase);

/** A tenant whose admin deleted a document, then a photo, of an obra. */
async function setup() {
  const tenant = await createTestTenant();
  const { token, user } = await staffToken(tenant.id, "admin");
  const ctx: Ctx = { tenantId: tenant.id, userId: user.id, role: "admin" };
  const project = await createTestProject(tenant.id, { ref: "VTH-26-001" });
  const document = await createTestDocument(tenant.id, project.id, { title: "Contrato de obra" });
  const photo = await createTestPhoto(tenant.id, project.id, { caption: "Fachada sur" });
  await documentsService.deleteDocument(ctx, project.id, document.id);
  await photosService.deletePhoto(ctx, project.id, photo.id);
  return { tenant, token, user, ctx, project, document, photo };
}

const restoreOf = (token: string | null, kind: string, id: string) =>
  restore(apiRequest(token, { method: "POST" }), routeParams({ kind, id }));

describe("GET /api/v1/deleted", () => {
  it("lists what was deleted, with who did it, filtered and paged", async () => {
    const { token, user, project, document, photo } = await setup();

    const all = await list(apiRequest(token));
    expect(all.status).toBe(200);
    const body = await all.json();
    expect(body.nextCursor).toBeNull();
    expect(body.projects).toEqual([{ id: project.id, ref: "VTH-26-001", deleted: false }]);
    expect(body.items).toHaveLength(2);
    expect(body.items.find((i: { id: string }) => i.id === document.id)).toMatchObject({
      kind: "document",
      label: "Contrato de obra",
      projectId: project.id,
      projectRef: "VTH-26-001",
      deletedBy: { id: user.id, name: user.name },
      restorable: true,
      parent: null,
    });
    expect(JSON.stringify(body)).not.toContain("pathname");

    const photos = await (await list(apiRequest(token, { query: "?kind=photo" }))).json();
    expect(photos.items.map((i: { id: string }) => i.id)).toEqual([photo.id]);
    const elsewhere = await (await list(apiRequest(token, { query: "?projectId=other" }))).json();
    expect(elsewhere.items).toEqual([]);

    const first = await (await list(apiRequest(token, { query: "?limit=1" }))).json();
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await (await list(apiRequest(token, { query: `?limit=1&cursor=${encodeURIComponent(first.nextCursor)}` }))).json();
    expect(second.items).toHaveLength(1);
    expect(second.nextCursor).toBeNull();
    expect(second.projects).toBeUndefined();
    expect(new Set([first.items[0].id, second.items[0].id])).toEqual(new Set([document.id, photo.id]));
  });

  it("answers 400 to a kind, limit or cursor it doesn't know", async () => {
    const { token } = await setup();
    for (const query of ["?kind=budget", "?limit=0", "?limit=x", "?cursor=nope"]) {
      const response = await list(apiRequest(token, { query }));
      expect(response.status).toBe(400);
      expect(await response.json()).toEqual({ error: "invalid_input" });
    }
  });

  it("is for admins only, signed in, and shows nothing of another tenant", async () => {
    const { tenant } = await setup();
    expect((await list(apiRequest(null))).status).toBe(401);
    for (const role of ["manager", "viewer"] as const) {
      const { token } = await staffToken(tenant.id, role);
      const response = await list(apiRequest(token));
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    const other = await createTestTenant();
    const { token } = await staffToken(other.id, "admin");
    expect(await (await list(apiRequest(token))).json()).toEqual({ items: [], nextCursor: null, projects: [] });
  });
});

describe("POST /api/v1/deleted/:kind/:id/restore", () => {
  it("restores a record: it is read again and leaves the list; a second time is 404", async () => {
    const { token, ctx, project, document } = await setup();

    const response = await restoreOf(token, "document", document.id);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "document", id: document.id, projectId: project.id });
    expect((await documentsService.listDocuments(ctx, project.id)).map((d) => d.id)).toEqual([document.id]);
    const left = await (await list(apiRequest(token))).json();
    expect(left.items.map((i: { kind: string }) => i.kind)).toEqual(["photo"]);

    const again = await restoreOf(token, "document", document.id);
    expect(again.status).toBe(404);
    expect(await again.json()).toEqual({ error: "not_found" });
  });

  it("answers with what stands in the way: 409 parent_deleted, 409 ref_taken, 404 for what isn't there", async () => {
    const { token, ctx, tenant, project, photo } = await setup();
    await projectsService.deleteProject(ctx, project.id);

    const child = await restoreOf(token, "photo", photo.id);
    expect(child.status).toBe(409);
    expect(await child.json()).toEqual({ error: "parent_deleted" });

    await createTestProject(tenant.id, { ref: "VTH-26-001" });
    const taken = await restoreOf(token, "project", project.id);
    expect(taken.status).toBe(409);
    expect(await taken.json()).toEqual({ error: "ref_taken" });

    for (const [kind, id] of [["photo", "no-such-id"], ["budget", photo.id], ["document", photo.id]] as const) {
      const response = await restoreOf(token, kind, id);
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "not_found" });
    }
  });

  it("is for admins only, signed in, and never restores another tenant's record", async () => {
    const { tenant, ctx, project, document } = await setup();
    expect((await restoreOf(null, "document", document.id)).status).toBe(401);
    for (const role of ["manager", "viewer"] as const) {
      const { token } = await staffToken(tenant.id, role);
      const response = await restoreOf(token, "document", document.id);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "forbidden" });
    }
    const other = await createTestTenant();
    const { token } = await staffToken(other.id, "admin");
    const response = await restoreOf(token, "document", document.id);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found" });
    expect(await documentsService.listDocuments(ctx, project.id)).toEqual([]);
  });

  it("refuses a cross-site call riding the admin's session", async () => {
    const { document } = await setup();
    const request = new Request("http://localhost/api/v1/test", { method: "POST", headers: { origin: "https://evil.example", host: "localhost" } });
    const response = await restore(request, routeParams({ kind: "document", id: document.id }));
    expect(response.status).toBe(403);
  });
});
