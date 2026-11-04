import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, projects } from "@repo/db";
import {
  createTestDocument,
  createTestPhoto,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import {
  changesService,
  clientProjectsService as svc,
  documentsService,
  obraService,
  photosService,
  projectClientService,
  type Ctx,
} from "../src";
import { files } from "../src/testing";

vi.mock("../src/storage", () => import("../src/testing"));

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin" });
  const client = await createTestUser(tenant.id, { role: "client" });
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  return { tenant, client, ctx };
}

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("getClientProject", () => {
  it("returns the client's project in the app's shape", async () => {
    const { tenant, client } = await setup();
    const project = await createTestProject(tenant.id, {
      ref: "VTH-2026-014",
      address: "Calle del Sol 5, Santander",
      startDate: day("2026-03-01"),
      completionDate: day("2026-11-15"),
      clientUserId: client.id,
    });

    expect(await svc.getClientProject(tenant.id, client.id)).toEqual({
      id: project.id,
      ref: "VTH-2026-014",
      address: "Calle del Sol 5, Santander",
      startDate: "2026-03-01",
      completionDate: "2026-11-15",
      handedOver: false,
      progressPct: null,
    });
  });

  it("returns null dates when they are not set", async () => {
    const { tenant, client } = await setup();
    await createTestProject(tenant.id, { clientUserId: client.id });

    expect(await svc.getClientProject(tenant.id, client.id)).toMatchObject({
      startDate: null,
      completionDate: null,
    });
  });

  it("returns null when the client has no project", async () => {
    const { tenant, client } = await setup();

    expect(await svc.getClientProject(tenant.id, client.id)).toBeNull();
  });

  it("does not return a project from another tenant", async () => {
    const { tenant, client } = await setup();
    await createTestProject(tenant.id, { clientUserId: client.id });
    const other = await createTestTenant();

    expect(await svc.getClientProject(other.id, client.id)).toBeNull();
  });

  it("opens on the newest open project, else the newest handed over", async () => {
    const { tenant, client } = await setup();
    const older = await createTestProject(tenant.id, { clientUserId: client.id, startDate: day("2025-01-10") });
    const newest = await createTestProject(tenant.id, { clientUserId: client.id, startDate: day("2026-03-10") });
    // Newer still, but handed over: never the default while one is open.
    const handedOver = await createTestProject(tenant.id, {
      clientUserId: client.id,
      startDate: day("2026-06-01"),
      obraStage: 8,
    });
    const defaultId = async () => (await svc.getClientProject(tenant.id, client.id))?.id;

    expect(await defaultId()).toBe(newest.id);

    await db.update(projects).set({ obraStage: 8 }).where(eq(projects.id, newest.id));
    expect(await defaultId()).toBe(older.id);

    await db.update(projects).set({ obraStage: 8 }).where(eq(projects.id, older.id));
    expect(await defaultId()).toBe(handedOver.id);
  });

  it("dates a project without a start by when it was created", async () => {
    const { tenant, client } = await setup();
    await createTestProject(tenant.id, { clientUserId: client.id, startDate: day("2020-01-01") });
    const unscheduled = await createTestProject(tenant.id, { clientUserId: client.id });

    expect((await svc.getClientProject(tenant.id, client.id))?.id).toBe(unscheduled.id);
  });

  it("returns the project asked for, if it is the client's", async () => {
    const { tenant, client } = await setup();
    const older = await createTestProject(tenant.id, { clientUserId: client.id, startDate: day("2025-01-10") });
    await createTestProject(tenant.id, { clientUserId: client.id, startDate: day("2026-03-10") });
    const someoneElses = await createTestProject(tenant.id, {
      clientUserId: (await createTestUser(tenant.id, { role: "client" })).id,
    });

    expect((await svc.getClientProject(tenant.id, client.id, older.id))?.id).toBe(older.id);
    await expect(svc.getClientProject(tenant.id, client.id, someoneElses.id)).rejects.toMatchObject({
      code: "project_not_found",
      status: 404,
    });
  });

  it("gives the progress only while the works are under way", async () => {
    const { tenant, client } = await setup();
    const building = await createTestProject(tenant.id, { clientUserId: client.id, obraStage: 6 });
    const done = await createTestProject(tenant.id, { clientUserId: client.id, obraStage: 8 });

    expect(await svc.getClientProject(tenant.id, client.id, building.id)).toMatchObject({
      handedOver: false,
      progressPct: 0,
    });
    expect(await svc.getClientProject(tenant.id, client.id, done.id)).toMatchObject({
      handedOver: true,
      progressPct: null,
    });
  });
});

describe("listClientProjects", () => {
  it("lists the client's projects, the default one first, then the open ones, then the handed over", async () => {
    const { tenant, client } = await setup();
    const handedOver = await createTestProject(tenant.id, {
      clientUserId: client.id,
      startDate: day("2026-06-01"),
      obraStage: 8,
    });
    const older = await createTestProject(tenant.id, { clientUserId: client.id, startDate: day("2025-01-10") });
    const newest = await createTestProject(tenant.id, { clientUserId: client.id, startDate: day("2026-03-10") });
    await createTestProject(tenant.id, { clientUserId: (await createTestUser(tenant.id, { role: "client" })).id });

    expect((await svc.listClientProjects(tenant.id, client.id)).map((p) => p.id)).toEqual([
      newest.id,
      older.id,
      handedOver.id,
    ]);
  });

  it("is empty without projects, and never reaches across tenants", async () => {
    const { tenant, client } = await setup();
    await createTestProject(tenant.id, { clientUserId: client.id });
    const other = await createTestTenant();

    expect(await svc.listClientProjects(other.id, client.id)).toEqual([]);
    expect(await svc.listClientProjects(tenant.id, (await createTestUser(tenant.id, { role: "client" })).id)).toEqual([]);
  });
});

describe("getClientChanges › projects (the key of the client's homes)", () => {
  it("moves when a project is attached or detached, or its dates or stage change", async () => {
    const { tenant, client, ctx } = await setup();
    const first = await createTestProject(tenant.id, { clientUserId: client.id });
    const second = await createTestProject(tenant.id);
    const key = async () => (await changesService.getClientChanges(tenant.id, client.id)).projects;
    const start = await key();

    await projectClientService.assignProjectClient(ctx, second.id, { clientId: client.id });
    const attached = await key();
    expect(attached).not.toBe(start);

    // Another home's progress refreshes on foreground, not on every obra write.
    await changesService.markChanged(tenant.id, first.id, ["photos", "documents", "obra"]);
    expect(await key()).toBe(attached);

    await changesService.markChanged(tenant.id, first.id, ["project"]);
    const dated = await key();
    expect(dated).not.toBe(attached);

    await db.update(projects).set({ obraStage: 8 }).where(eq(projects.id, first.id));
    const moved = await key();
    expect(moved).not.toBe(dated);

    await projectClientService.unassignProjectClient(ctx, second.id);
    expect(await key()).not.toBe(moved);
  });

  it("is empty without projects", async () => {
    const { tenant, client } = await setup();

    expect(await changesService.getClientChanges(tenant.id, client.id)).toEqual({ changes: null, projects: "" });
  });
});

describe("the app's data, per project", () => {
  async function twoHomes() {
    const s = await setup();
    const older = await createTestProject(s.tenant.id, { clientUserId: s.client.id, startDate: day("2025-01-10") });
    const newest = await createTestProject(s.tenant.id, { clientUserId: s.client.id, startDate: day("2026-03-10") });
    return { ...s, older, newest };
  }

  it("lists the photos and documents of the project asked for, else of the default one", async () => {
    const { tenant, client, older, newest } = await twoHomes();
    const oldPhoto = await createTestPhoto(tenant.id, older.id);
    const newPhoto = await createTestPhoto(tenant.id, newest.id);
    const oldDoc = await createTestDocument(tenant.id, older.id);
    const newDoc = await createTestDocument(tenant.id, newest.id);

    expect((await photosService.listClientPhotos(tenant.id, client.id)).map((p) => p.id)).toEqual([newPhoto.id]);
    expect((await photosService.listClientPhotos(tenant.id, client.id, older.id)).map((p) => p.id)).toEqual([oldPhoto.id]);
    expect((await documentsService.listClientDocuments(tenant.id, client.id)).map((d) => d.id)).toEqual([newDoc.id]);
    expect(
      (await documentsService.listClientDocuments(tenant.id, client.id, { projectId: older.id })).map((d) => d.id),
    ).toEqual([oldDoc.id]);
  });

  it("opens a photo or document of any of the client's projects", async () => {
    const { tenant, client, older } = await twoHomes();
    const photo = await createTestPhoto(tenant.id, older.id);
    const doc = await createTestDocument(tenant.id, older.id);
    files.set(photo.pathname, new Blob(["jpeg"]));
    files.set(doc.pathname, new Blob(["%PDF"]));

    await expect(photosService.openClientPhoto(tenant.id, client.id, photo.id)).resolves.toBeDefined();
    await expect(documentsService.openClientDocument(tenant.id, client.id, doc.id)).resolves.toBeDefined();
  });

  it("refuses a project that isn't the client's", async () => {
    const { tenant, client } = await twoHomes();
    const theirs = await createTestProject(tenant.id, {
      clientUserId: (await createTestUser(tenant.id, { role: "client" })).id,
    });
    const notFound = { code: "project_not_found", status: 404 };

    await expect(photosService.listClientPhotos(tenant.id, client.id, theirs.id)).rejects.toMatchObject(notFound);
    await expect(
      documentsService.listClientDocuments(tenant.id, client.id, { projectId: theirs.id }),
    ).rejects.toMatchObject(notFound);
    await expect(obraService.getClientObra(tenant.id, client.id, theirs.id)).rejects.toMatchObject(notFound);
  });

  it("gives the change counters of the project asked for; null once it isn't theirs", async () => {
    const { tenant, client, older, newest, ctx } = await twoHomes();

    const changes = async (projectId?: string) =>
      (await changesService.getClientChanges(tenant.id, client.id, projectId)).changes;

    expect(await changes()).toMatchObject({ projectId: newest.id });
    expect(await changes(older.id)).toMatchObject({ projectId: older.id });

    await projectClientService.unassignProjectClient(ctx, older.id);
    expect(await changes(older.id)).toBeNull();
  });
});
