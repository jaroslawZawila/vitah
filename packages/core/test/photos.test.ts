import { beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, projectPhotos, projects } from "@repo/db";
import {
  createTestPhoto,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import { MAX_PHOTO_BYTES, photosService as svc, projectsService, type Ctx } from "../src";
import { files } from "../src/testing";

vi.mock("../src/storage", () => import("../src/testing"));

const JPEG = [0xff, 0xd8, 0xff, 0xe0];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const image = (magic: number[], name = "fachada.jpg") =>
  new File([new Uint8Array(magic), "pixels"], name, { type: "image/jpeg" });
const jpeg = () => image(JPEG);
const webp = () => new File(["RIFF\0\0\0\0WEBPVP8 "], "obra.webp");

/** A tenant with an admin caller, a project, and its client. */
async function setup() {
  const tenant = await createTestTenant();
  const admin = await createTestUser(tenant.id, { role: "admin", name: "Admin" });
  const client = await createTestUser(tenant.id, { role: "client" });
  const project = await createTestProject(tenant.id, { clientUserId: client.id });
  const ctx: Ctx = { tenantId: tenant.id, userId: admin.id, role: "admin" };
  return { tenant, admin, client, project, ctx };
}

const upload = (ctx: Ctx, projectId: string, input: Record<string, unknown> = {}) =>
  svc.addPhoto(ctx, projectId, { caption: "Fachada sur", file: jpeg(), ...input });

async function bytes(stream: ReadableStream<Uint8Array>) {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

beforeEach(async () => {
  await resetDatabase();
  files.clear();
});

describe("addPhoto", () => {
  it("stores the image and records it", async () => {
    const { tenant, project, ctx } = await setup();

    const { photoId } = await upload(ctx, project.id, { caption: "  Fachada sur " });

    const row = await db.query.projectPhotos.findFirst({ where: eq(projectPhotos.id, photoId) });
    expect(row).toMatchObject({
      tenantId: tenant.id,
      projectId: project.id,
      caption: "Fachada sur",
      contentType: "image/jpeg",
      sizeBytes: jpeg().size,
      uploadedById: ctx.userId,
    });
    expect(row?.pathname).toBe(`tenants/${tenant.id}/projects/${project.id}/photos/${photoId}.jpg`);
    expect(files.has(row!.pathname)).toBe(true);
  });

  it.each([
    ["image/png", "png", image(PNG, "x.png")],
    ["image/webp", "webp", webp()],
  ])("detects %s from the file's bytes", async (contentType, extension, file) => {
    const { project, ctx } = await setup();

    const { photoId } = await upload(ctx, project.id, { file });

    const row = await db.query.projectPhotos.findFirst({ where: eq(projectPhotos.id, photoId) });
    expect(row?.contentType).toBe(contentType);
    expect(row?.pathname).toMatch(new RegExp(`/${photoId}\\.${extension}$`));
  });

  it("stores a blank caption as none", async () => {
    const { project, ctx } = await setup();

    const { photoId } = await upload(ctx, project.id, { caption: "   " });

    const row = await db.query.projectPhotos.findFirst({ where: eq(projectPhotos.id, photoId) });
    expect(row?.caption).toBeNull();
  });

  it("lets managers upload", async () => {
    const { project, ctx } = await setup();

    await expect(upload({ ...ctx, role: "manager" }, project.id)).resolves.toHaveProperty(
      "photoId",
    );
  });

  it("is forbidden for viewers", async () => {
    const { project, ctx } = await setup();

    await expect(upload({ ...ctx, role: "viewer" }, project.id)).rejects.toMatchObject({
      code: "forbidden",
      status: 403,
    });
    expect(files.size).toBe(0);
  });

  it.each([
    ["missing_file", { file: undefined }],
    ["missing_file", { file: new File([], "empty.jpg") }],
    ["missing_file", { file: "not a file" }],
    ["invalid_file_type", { file: new File(["%PDF-1.7"], "fake.jpg", { type: "image/jpeg" }) }],
  ])("rejects %s", async (code, input) => {
    const { project, ctx } = await setup();

    await expect(upload(ctx, project.id, input)).rejects.toMatchObject({ code, status: 400 });
    expect(files.size).toBe(0);
  });

  it("rejects files over the size limit", async () => {
    const { project, ctx } = await setup();
    const big = new File([new Uint8Array(JPEG), new Uint8Array(MAX_PHOTO_BYTES)], "big.jpg");

    await expect(upload(ctx, project.id, { file: big })).rejects.toMatchObject({
      code: "file_too_large",
      status: 413,
    });
  });

  it("does not upload to another tenant's project", async () => {
    const { project } = await setup();
    const other = await setup();

    await expect(upload(other.ctx, project.id)).rejects.toMatchObject({
      code: "project_not_found",
      status: 404,
    });
    expect(files.size).toBe(0);
  });
});

describe("listPhotos", () => {
  it("lists the project's photos, newest first, with the uploader", async () => {
    const { tenant, admin, project, ctx } = await setup();
    const older = await createTestPhoto(tenant.id, project.id, {
      caption: null,
      sizeBytes: 4096,
      createdAt: new Date("2026-01-01T10:00:00Z"),
    });
    const newer = await createTestPhoto(tenant.id, project.id, {
      uploadedById: admin.id,
      createdAt: new Date("2026-02-01T10:00:00Z"),
    });
    await createTestPhoto(tenant.id, (await createTestProject(tenant.id)).id);

    expect(await svc.listPhotos({ ...ctx, role: "viewer" }, project.id)).toEqual([
      {
        id: newer.id,
        caption: "Fachada sur",
        sizeBytes: 2048,
        uploadedAt: "2026-02-01T10:00:00.000Z",
        uploadedBy: "Admin",
      },
      {
        id: older.id,
        caption: null,
        sizeBytes: 4096,
        uploadedAt: "2026-01-01T10:00:00.000Z",
        uploadedBy: null,
      },
    ]);
  });

  it("does not list another tenant's project", async () => {
    const { project } = await setup();
    const other = await setup();

    await expect(svc.listPhotos(other.ctx, project.id)).rejects.toMatchObject({
      code: "project_not_found",
    });
  });
});

describe("deletePhoto", () => {
  it("removes the row and the file", async () => {
    const { project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id);

    await expect(svc.deletePhoto({ ...ctx, role: "manager" }, project.id, photoId)).resolves.toEqual(
      { photoId },
    );

    expect(await svc.listPhotos(ctx, project.id)).toEqual([]);
    expect(files.size).toBe(0);
  });

  it("is forbidden for viewers", async () => {
    const { project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id);

    await expect(
      svc.deletePhoto({ ...ctx, role: "viewer" }, project.id, photoId),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(files.size).toBe(1);
  });

  it("does not delete another tenant's photo", async () => {
    const { project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id);
    const other = await setup();

    await expect(svc.deletePhoto(other.ctx, project.id, photoId)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    expect(files.size).toBe(1);
  });
});

describe("openPhoto", () => {
  it("streams the image to staff of the tenant", async () => {
    const { project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id);

    const file = await svc.openPhoto({ ...ctx, role: "viewer" }, project.id, photoId);

    expect(file).toMatchObject({
      filename: `${photoId}.jpg`,
      contentType: "image/jpeg",
      sizeBytes: jpeg().size,
    });
    expect(await bytes(file.body)).toEqual(new Uint8Array(await jpeg().arrayBuffer()));
  });

  it("is not found for another tenant", async () => {
    const { project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id);
    const other = await setup();

    await expect(svc.openPhoto(other.ctx, project.id, photoId)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("is not found when the stored file is missing", async () => {
    const { tenant, project, ctx } = await setup();
    const photo = await createTestPhoto(tenant.id, project.id);

    await expect(svc.openPhoto(ctx, project.id, photo.id)).rejects.toMatchObject({
      code: "not_found",
    });
  });
});

describe("client photos", () => {
  it("lists only the client's own project's photos", async () => {
    const { tenant, client, project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id);
    await upload(ctx, (await createTestProject(tenant.id)).id);
    const other = await setup();
    await upload(other.ctx, other.project.id);

    expect(await svc.listClientPhotos(tenant.id, client.id)).toEqual([
      {
        id: photoId,
        caption: "Fachada sur",
        sizeBytes: jpeg().size,
        uploadedAt: expect.any(String),
      },
    ]);
  });

  it("lists nothing for a client without a project", async () => {
    const { tenant, client, project, ctx } = await setup();
    await upload(ctx, project.id);
    await db.update(projects).set({ clientUserId: null }).where(eq(projects.id, project.id));

    expect(await svc.listClientPhotos(tenant.id, client.id)).toEqual([]);
  });

  it("opens the client's own photo", async () => {
    const { tenant, client, project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id);

    const file = await svc.openClientPhoto(tenant.id, client.id, photoId);

    expect(file.contentType).toBe("image/jpeg");
    expect((await bytes(file.body)).length).toBe(jpeg().size);
  });

  it("does not open another client's photo", async () => {
    const { tenant, client } = await setup();
    const other = await setup();
    const { photoId } = await upload(other.ctx, other.project.id);
    const sameTenantProject = await createTestProject(tenant.id);
    const { photoId: unassigned } = await upload(
      { ...other.ctx, tenantId: tenant.id },
      sameTenantProject.id,
    );

    for (const [tenantId, id] of [
      [tenant.id, photoId],
      [other.tenant.id, photoId],
      [tenant.id, unassigned],
    ] as const) {
      await expect(svc.openClientPhoto(tenantId, client.id, id)).rejects.toMatchObject({
        code: "not_found",
        status: 404,
      });
    }
  });
});

describe("deleteProject", () => {
  it("also deletes the project's photos", async () => {
    const { project, ctx } = await setup();
    await upload(ctx, project.id);
    const other = await setup();
    await upload(other.ctx, other.project.id);

    await projectsService.deleteProject(ctx, project.id);

    expect([...files.keys()]).toEqual([expect.stringContaining(other.project.id)]);
  });
});
