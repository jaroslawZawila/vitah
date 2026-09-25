import sharp from "sharp";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db, eq, projectPhotos, projects } from "@repo/db";
import {
  createTestPhoto,
  createTestProject,
  createTestTenant,
  createTestUser,
  resetDatabase,
} from "@repo/db/testing";
import {
  MAX_PHOTO_BYTES,
  parsePhotoSize,
  photoSizeQuery,
  photosService as svc,
  projectsService,
  type Ctx,
} from "../src";
import { files, testImage } from "../src/testing";

vi.mock("../src/storage", () => import("../src/testing"));

let photo: File; // a 1600×1200 JPEG

beforeAll(async () => {
  photo = await testImage();
});

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
  svc.addPhoto(ctx, projectId, { caption: "Fachada sur", file: photo, ...input });

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
      sizeBytes: photo.size,
      uploadedById: ctx.userId,
    });
    expect(row?.pathname).toBe(`tenants/${tenant.id}/projects/${project.id}/photos/${photoId}.jpg`);
    expect(files.has(row!.pathname)).toBe(true);
  });

  it("makes an upright WebP thumbnail of at most 800 px", async () => {
    const { tenant, project, ctx } = await setup();
    // Stored landscape; EXIF orientation 6 turns it portrait.
    const rotated = await sharp(await photo.arrayBuffer()).withMetadata({ orientation: 6 }).toBuffer();

    const { photoId } = await upload(ctx, project.id, { file: new File([new Uint8Array(rotated)], "x.jpg") });

    const row = await db.query.projectPhotos.findFirst({ where: eq(projectPhotos.id, photoId) });
    const thumb = files.get(
      `tenants/${tenant.id}/projects/${project.id}/photos/${photoId}.thumb.webp`,
    )!;
    expect(row?.thumbSizeBytes).toBe(thumb.size);
    expect(thumb.size).toBeLessThan(photo.size);
    const meta = await sharp(await thumb.arrayBuffer()).metadata();
    expect(meta).toMatchObject({ format: "webp", width: 600, height: 800 });
    expect(meta.orientation).toBeUndefined();
  });

  it("does not enlarge small photos for the thumbnail", async () => {
    const { project, ctx } = await setup();

    const { photoId } = await upload(ctx, project.id, { file: await testImage("png", 300, 200) });

    const row = await db.query.projectPhotos.findFirst({ where: eq(projectPhotos.id, photoId) });
    const thumb = files.get(row!.pathname.replace(".png", ".thumb.webp"))!;
    expect(await sharp(await thumb.arrayBuffer()).metadata()).toMatchObject({
      width: 300,
      height: 200,
    });
  });

  it.each([
    ["image/png", "png", "png"],
    ["image/webp", "webp", "webp"],
  ] as const)("detects %s from the file's bytes", async (contentType, extension, format) => {
    const { project, ctx } = await setup();
    // Named and typed as a JPEG: only the bytes count.
    const file = new File([await testImage(format)], "x.jpg", { type: "image/jpeg" });

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
    // A JPEG header with nothing decodable behind it.
    ["invalid_file_type", { file: new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0]), "x"], "cut.jpg") }],
    ["invalid_file_type", { file: new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "x.svg") }],
  ])("rejects %s", async (code, input) => {
    const { project, ctx } = await setup();

    await expect(upload(ctx, project.id, input)).rejects.toMatchObject({ code, status: 400 });
    expect(files.size).toBe(0);
  });

  it("rejects files over the size limit", async () => {
    const { project, ctx } = await setup();
    const big = new File([photo, new Uint8Array(MAX_PHOTO_BYTES)], "big.jpg");

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
    expect(files.size).toBe(2); // the photo and its thumbnail
  });

  it("does not delete another tenant's photo", async () => {
    const { project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id);
    const other = await setup();

    await expect(svc.deletePhoto(other.ctx, project.id, photoId)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    expect(files.size).toBe(2); // the photo and its thumbnail
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
      sizeBytes: photo.size,
    });
    expect(await bytes(file.body)).toEqual(new Uint8Array(await photo.arrayBuffer()));
  });

  it("streams the thumbnail on request", async () => {
    const { project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id);

    const file = await svc.openPhoto(ctx, project.id, photoId, "thumb");

    expect(file).toMatchObject({ filename: `${photoId}.thumb.webp`, contentType: "image/webp" });
    const body = await bytes(file.body);
    expect(body.length).toBe(file.sizeBytes);
    expect(await sharp(body).metadata()).toMatchObject({ width: 800, height: 600 });
  });

  it("falls back to the photo for photos stored before thumbnails", async () => {
    const { tenant, project, ctx } = await setup();
    const old = await createTestPhoto(tenant.id, project.id, { sizeBytes: photo.size });
    files.set(old.pathname, photo);

    const file = await svc.openPhoto(ctx, project.id, old.id, "thumb");

    expect(file).toMatchObject({ contentType: "image/jpeg", sizeBytes: photo.size });
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
        sizeBytes: photo.size,
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
    expect((await bytes(file.body)).length).toBe(photo.size);
    const thumb = await svc.openClientPhoto(tenant.id, client.id, photoId, "thumb");
    expect(thumb.contentType).toBe("image/webp");
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

    // Only the other project's photo and thumbnail are left.
    expect([...files.keys()]).toEqual([
      expect.stringContaining(other.project.id),
      expect.stringContaining(other.project.id),
    ]);
  });
});

describe("photo sizes in URLs", () => {
  it("asks for the thumbnail with ?size=thumb and the original with nothing", () => {
    expect(photoSizeQuery("thumb")).toBe("?size=thumb");
    expect(photoSizeQuery("full")).toBe("");
  });

  it("reads ?size=, treating missing or unknown values as the original", () => {
    expect(parsePhotoSize("thumb")).toBe("thumb");
    expect(parsePhotoSize("full")).toBe("full");
    expect(parsePhotoSize(null)).toBe("full");
    expect(parsePhotoSize("huge")).toBe("full");
  });
});
