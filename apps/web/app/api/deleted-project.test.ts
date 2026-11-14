import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDocument, createTestPhoto, createTestProject, createTestTenant, createTestUser, resetDatabase } from "@repo/db/testing";
import { db, eq, projectDocuments, projectPhotos, projects } from "@repo/db";
import { files } from "@repo/core/testing";
import { apiRequest, clientToken, routeParams, seededObraProject, staffToken } from "../../test/api";
import { GET as mobileChanges } from "./mobile/changes/route";
import { GET as mobileDocuments } from "./mobile/documents/route";
import { GET as mobileDocument } from "./mobile/documents/[id]/route";
import { GET as mobileObra } from "./mobile/obra/route";
import { GET as mobileHitoFile } from "./mobile/obra/hitos/[id]/[kind]/route";
import { GET as mobilePhotos } from "./mobile/photos/route";
import { GET as mobilePhoto } from "./mobile/photos/[id]/route";
import { GET as mobileProject } from "./mobile/project/route";
import { GET as mobileProjects } from "./mobile/projects/route";
import { GET as listProjects, POST as createProject } from "./v1/projects/route";
import { DELETE as deleteProject, GET as getProject } from "./v1/projects/[id]/route";
import { GET as getBudget, POST as createBudget } from "./v1/projects/[id]/budget/route";
import { GET as getDocuments } from "./v1/projects/[id]/documents/route";
import { GET as getHitos } from "./v1/projects/[id]/hitos/route";
import { GET as getObra, PUT as setStage } from "./v1/projects/[id]/obra/route";
import { GET as getControl } from "./v1/projects/[id]/obra/control/route";
import { GET as getPhotos } from "./v1/projects/[id]/photos/route";
import { GET as getPlanning } from "./v1/projects/[id]/planning/route";
import { GET as getPurchases } from "./v1/projects/[id]/purchases/route";

// A deleted project is archived (packages/core covers the service): here, what
// the API then answers, to staff (/api/v1) and to the project's client in the
// app (/api/mobile), as if the project had never been there.

vi.mock("@repo/auth", () => ({ auth: vi.fn() }));
vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

const json = async (response: Response) => ({ status: response.status, body: await response.json() });

/** DELETE /api/v1/projects/:id, as an admin of the tenant. */
async function remove(tenantId: string, projectId: string) {
  const { token } = await staffToken(tenantId, "admin");
  const response = await deleteProject(apiRequest(token, { method: "DELETE" }), routeParams({ id: projectId }));
  expect(response.status).toBe(204);
}

describe("/api/v1 once a project is deleted", () => {
  it("answers 404 on the project and everything under it, and leaves it off the list", async () => {
    const { tenant, project } = await seededObraProject();
    const other = await createTestProject(tenant.id);
    const { token } = await staffToken(tenant.id, "admin");
    const id = routeParams({ id: project.id });
    expect((await getObra(apiRequest(token), id)).status).toBe(200);

    await remove(tenant.id, project.id);

    expect(await json(await getProject(apiRequest(token), id))).toEqual({ status: 404, body: { error: "not_found" } });
    const gone = { status: 404, body: { error: "project_not_found" } };
    for (const read of [getBudget, getDocuments, getHitos, getObra, getControl, getPhotos, getPlanning, getPurchases]) {
      expect(await json(await read(apiRequest(token), id))).toEqual(gone);
    }
    expect(await json(await setStage(apiRequest(token, { method: "PUT", body: { stage: 7 } }), id))).toEqual(gone);
    expect(await json(await createBudget(apiRequest(token, { method: "POST", body: {} }), id))).toEqual(gone);

    const list = await json(await listProjects(apiRequest(token)));
    expect(list.body.map((p: { id: string }) => p.id)).toEqual([other.id]);
    // The other project is as it was.
    expect((await getProject(apiRequest(token), routeParams({ id: other.id }))).status).toBe(200);
    expect((await getObra(apiRequest(token), routeParams({ id: other.id }))).status).toBe(200);
  });

  it("lets a new project take the deleted one's ref", async () => {
    const tenant = await createTestTenant();
    const project = await createTestProject(tenant.id, { ref: "VTH-26-030" });
    const { token } = await staffToken(tenant.id, "admin");
    const create = () => createProject(apiRequest(token, { method: "POST", body: { ref: "VTH-26-030", address: "Calle Nueva 2" } }));
    expect(await json(await create())).toEqual({ status: 400, body: { error: "ref_exists" } });

    await remove(tenant.id, project.id);

    const created = await json(await create());
    expect(created).toEqual({ status: 201, body: { id: expect.any(String) } });
    expect((await json(await listProjects(apiRequest(token)))).body).toMatchObject([{ id: created.body.id, ref: "VTH-26-030" }]);
    expect(await db.select({ id: projects.id }).from(projects).where(eq(projects.ref, "VTH-26-030"))).toHaveLength(2);
  });
});

describe("/api/mobile once a client's project is deleted", () => {
  const mobile = (token: string, projectId?: string) => apiRequest(token, { query: projectId ? `?projectId=${projectId}` : "" });

  /** A client with two homes: the seeded obra (the default one, under way) and an older one handed over. */
  async function twoHomes() {
    const { tenant, project: current } = await seededObraProject();
    const client = await createTestUser(tenant.id, { role: "client" });
    await db.update(projects).set({ clientUserId: client.id }).where(eq(projects.id, current.id));
    const older = await createTestProject(tenant.id, { clientUserId: client.id, obraStage: 8, startDate: new Date("2024-02-01") });
    const withFiles = async (projectId: string) => {
      const photo = await createTestPhoto(tenant.id, projectId);
      const document = await createTestDocument(tenant.id, projectId);
      files.set(photo.pathname, new Blob(["jpeg"]));
      files.set(document.pathname, new Blob(["%PDF-1.7"]));
      return { photo, document };
    };
    return {
      tenant,
      token: await clientToken(tenant.id, client.id, client.email),
      current: { id: current.id, ...(await withFiles(current.id)) },
      older: { id: older.id, ...(await withFiles(older.id)) },
    };
  }

  it("takes the home away from the client, their other home working as before", async () => {
    const { tenant, token, current, older } = await twoHomes();
    const before = (await json(await mobileChanges(mobile(token)))).body;
    expect(before.changes.projectId).toBe(current.id);
    const { obra } = (await json(await mobileObra(mobile(token)))).body;
    const h3 = obra.hitos.find((h: { code: string }) => h.code === "H3");
    const invoice = () => mobileHitoFile(mobile(token), routeParams({ id: h3.id, kind: "invoice" }));
    expect((await invoice()).status).toBe(200);
    const stored = files.size;

    await remove(tenant.id, current.id);

    // The app opens on the home that is left.
    const ids = (body: { projects: { id: string }[] }) => body.projects.map((p) => p.id);
    expect(ids((await json(await mobileProjects(mobile(token)))).body)).toEqual([older.id]);
    expect((await json(await mobileProject(mobile(token)))).body.project).toMatchObject({ id: older.id, handedOver: true });
    expect((await json(await mobileObra(mobile(token)))).body.obra).toMatchObject({ stage: 8 });
    expect((await json(await mobilePhotos(mobile(token)))).body.photos.map((p: { id: string }) => p.id)).toEqual([older.photo.id]);
    expect((await json(await mobileDocuments(mobile(token)))).body.documents.map((d: { id: string }) => d.id)).toEqual([
      older.document.id,
    ]);
    expect((await mobilePhoto(mobile(token), routeParams({ id: older.photo.id }))).status).toBe(200);
    expect((await mobileDocument(mobile(token), routeParams({ id: older.document.id }))).status).toBe(200);
    // The poll of an app still showing the deleted home says so: null, and the homes' key moved.
    const after = (await json(await mobileChanges(mobile(token, current.id)))).body;
    expect(after.changes).toBeNull();
    expect(after.projects).not.toBe(before.projects);
    expect(after.projects).not.toContain(current.id);
    expect((await json(await mobileChanges(mobile(token)))).body.changes).toMatchObject({ projectId: older.id });

    // Asked for by its id, the deleted home isn't theirs; its files are kept but no longer served.
    const notTheirs = { status: 404, body: { error: "project_not_found" } };
    for (const read of [mobileProject, mobileObra, mobilePhotos, mobileDocuments]) {
      expect(await json(await read(mobile(token, current.id)))).toEqual(notTheirs);
    }
    const notFound = { status: 404, body: { error: "not_found" } };
    expect(await json(await mobilePhoto(mobile(token), routeParams({ id: current.photo.id })))).toEqual(notFound);
    expect(await json(await mobileDocument(mobile(token), routeParams({ id: current.document.id })))).toEqual(notFound);
    expect(await json(await invoice())).toEqual(notFound);
    expect(files.size).toBe(stored);
    expect(await db.select().from(projectPhotos).where(eq(projectPhotos.id, current.photo.id))).toHaveLength(1);
    expect(await db.select().from(projectDocuments).where(eq(projectDocuments.id, current.document.id))).toHaveLength(1);
  });

  it("leaves a client whose only home it was with an empty app, as when they are removed from it", async () => {
    const tenant = await createTestTenant();
    const client = await createTestUser(tenant.id, { role: "client" });
    const project = await createTestProject(tenant.id, { clientUserId: client.id });
    await createTestPhoto(tenant.id, project.id);
    await createTestDocument(tenant.id, project.id);
    const token = await clientToken(tenant.id, client.id, client.email);
    expect((await json(await mobileProject(mobile(token)))).body.project).toMatchObject({ id: project.id });

    await remove(tenant.id, project.id);

    expect(await json(await mobileProject(mobile(token)))).toEqual({ status: 200, body: { project: null } });
    expect(await json(await mobileProjects(mobile(token)))).toEqual({ status: 200, body: { projects: [] } });
    expect(await json(await mobileObra(mobile(token)))).toEqual({ status: 200, body: { obra: null } });
    expect(await json(await mobilePhotos(mobile(token)))).toEqual({ status: 200, body: { photos: [] } });
    expect(await json(await mobileDocuments(mobile(token)))).toEqual({ status: 200, body: { documents: [] } });
    expect(await json(await mobileChanges(mobile(token)))).toEqual({ status: 200, body: { changes: null, projects: "" } });
    expect(await json(await mobileProject(mobile(token, project.id)))).toEqual({ status: 404, body: { error: "project_not_found" } });
  });
});
