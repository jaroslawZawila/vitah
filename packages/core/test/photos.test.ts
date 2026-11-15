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

  it("records the day it was taken and its chapter; refuses a day after today", async () => {
    const { project, ctx } = await setup();

    const { photoId } = await upload(ctx, project.id, { takenOn: "2026-03-02", chapterCode: "06" });
    const row = await db.query.projectPhotos.findFirst({ where: eq(projectPhotos.id, photoId) });
    expect(row).toMatchObject({ takenOn: "2026-03-02", chapterCode: "06" });

    await expect(upload(ctx, project.id, { takenOn: "2999-01-01" })).rejects.toMatchObject({ code: "invalid_date" });
    await expect(upload(ctx, project.id, { takenOn: "02/03/2026" })).rejects.toMatchObject({ code: "invalid_date" });
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

  it("rejects an image too large to decode safely", async () => {
    const { project, ctx } = await setup();
    // 10000×6000 = 60 MP of one colour: a tiny PNG that decodes to 240 MB.
    const bomb = await sharp({
      create: { width: 10_000, height: 6_000, channels: 3, background: "#000" },
    })
      .png()
      .toBuffer();
    expect(bomb.length).toBeLessThan(MAX_PHOTO_BYTES);

    await expect(
      upload(ctx, project.id, { file: new File([new Uint8Array(bomb)], "x.png") }),
    ).rejects.toMatchObject({ code: "invalid_file_type" });
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

  it("tags the photo with the budget chapter it shows", async () => {
    const { project, ctx } = await setup();

    const { photoId } = await upload(ctx, project.id, { chapterCode: " 05 " });
    await upload(ctx, project.id);

    const row = await db.query.projectPhotos.findFirst({ where: eq(projectPhotos.id, photoId) });
    expect(row?.chapterCode).toBe("05");
    const tagged = await svc.listPhotos(ctx, project.id, { chapterCode: "05" });
    expect(tagged.map((p) => p.id)).toEqual([photoId]);
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
        chapterCode: null,
        takenOn: "2026-02-01",
        visibleToClient: true,
      },
      {
        id: older.id,
        caption: null,
        sizeBytes: 4096,
        uploadedAt: "2026-01-01T10:00:00.000Z",
        uploadedBy: null,
        chapterCode: null,
        takenOn: "2026-01-01",
        visibleToClient: true,
      },
    ]);
  });

  it("orders photos by the day they were taken, as staff set it", async () => {
    const { tenant, project, ctx } = await setup();
    const late = await createTestPhoto(tenant.id, project.id, { createdAt: new Date("2026-01-01T10:00:00Z"), takenOn: "2026-03-01" });
    const early = await createTestPhoto(tenant.id, project.id, { createdAt: new Date("2026-02-01T10:00:00Z"), chapterCode: "06" });

    const photos = await svc.listPhotos(ctx, project.id);
    expect(photos.map((p) => [p.id, p.takenOn, p.chapterCode])).toEqual([
      [late.id, "2026-03-01", null],
      [early.id, "2026-02-01", "06"],
    ]);
    expect(await svc.listPhotos(ctx, project.id, { limit: 1 })).toHaveLength(1);
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
  const rowOf = (photoId: string) => db.query.projectPhotos.findFirst({ where: eq(projectPhotos.id, photoId) });

  it("marks the row as deleted, with who did it, and keeps the image and its thumbnail", async () => {
    const { tenant, project, ctx } = await setup();
    const manager = await createTestUser(tenant.id, { role: "manager" });
    const { photoId } = await upload(ctx, project.id);

    await expect(
      svc.deletePhoto({ ...ctx, userId: manager.id, role: "manager" }, project.id, photoId),
    ).resolves.toEqual({ photoId });

    const row = await rowOf(photoId);
    expect(row).toMatchObject({ caption: "Fachada sur", deletedAt: expect.any(Date), deletedById: manager.id });
    expect([...files.keys()].sort()).toEqual([row!.pathname, row!.pathname.replace(".jpg", ".thumb.webp")].sort());
  });

  it("leaves it out of the staff list and images, and of the client's app", async () => {
    const { tenant, client, project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id, { chapterCode: "05" });
    const kept = await upload(ctx, project.id, { chapterCode: "05" });

    await svc.deletePhoto(ctx, project.id, photoId);

    expect((await svc.listPhotos(ctx, project.id)).map((p) => p.id)).toEqual([kept.photoId]);
    expect((await svc.listPhotos(ctx, project.id, { chapterCode: "05" })).map((p) => p.id)).toEqual([kept.photoId]);
    for (const size of ["full", "thumb"] as const) {
      await expect(svc.openPhoto(ctx, project.id, photoId, size)).rejects.toMatchObject({ code: "not_found", status: 404 });
      await expect(svc.openClientPhoto(tenant.id, client.id, photoId, size)).rejects.toMatchObject({ code: "not_found", status: 404 });
    }
    expect((await svc.listClientPhotos(tenant.id, client.id)).map((p) => p.id)).toEqual([kept.photoId]);
    // The obra's phases show the chapter's photos.
    expect((await svc.photosByChapter(tenant.id, project.id)).get("05")?.map((p) => p.id)).toEqual([kept.photoId]);
    // The one beside it is untouched.
    expect((await svc.openClientPhoto(tenant.id, client.id, kept.photoId, "thumb")).contentType).toBe("image/webp");
  });

  it("is not found from then on: deleting it again or showing it", async () => {
    const { project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id);
    await svc.deletePhoto(ctx, project.id, photoId);
    const { deletedAt } = (await rowOf(photoId))!;

    await expect(svc.deletePhoto(ctx, project.id, photoId)).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(svc.setPhotoVisibility(ctx, project.id, photoId, { visibleToClient: false })).rejects.toMatchObject({ code: "not_found" });
    // The first delete's mark stands.
    expect(await rowOf(photoId)).toMatchObject({ deletedAt, visibleToClient: true });
  });

  it("is forbidden for viewers", async () => {
    const { project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id);

    await expect(
      svc.deletePhoto({ ...ctx, role: "viewer" }, project.id, photoId),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(await rowOf(photoId)).toMatchObject({ deletedAt: null, deletedById: null });
    expect((await svc.listPhotos(ctx, project.id)).map((p) => p.id)).toEqual([photoId]);
  });

  it("does not delete another tenant's photo", async () => {
    const { project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id);
    const other = await setup();

    await expect(svc.deletePhoto(other.ctx, project.id, photoId)).rejects.toMatchObject({
      code: "not_found",
      status: 404,
    });
    // Nor through a project of their own.
    await expect(svc.deletePhoto(other.ctx, other.project.id, photoId)).rejects.toMatchObject({ code: "not_found" });
    expect(await rowOf(photoId)).toMatchObject({ deletedAt: null, deletedById: null });
    expect((await svc.listPhotos(ctx, project.id)).map((p) => p.id)).toEqual([photoId]);
  });
});

describe("a deleted project's photos", () => {
  it("are not found by their own id: image, thumbnail, delete, visibility", async () => {
    const { project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id);
    await db.update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, project.id));

    for (const size of ["full", "thumb"] as const) {
      await expect(svc.openPhoto(ctx, project.id, photoId, size)).rejects.toMatchObject({ code: "not_found", status: 404 });
    }
    await expect(svc.deletePhoto(ctx, project.id, photoId)).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(svc.setPhotoVisibility(ctx, project.id, photoId, { visibleToClient: false })).rejects.toMatchObject({ status: 404 });

    // Nothing was written, and the files are kept.
    const row = await db.query.projectPhotos.findFirst({ where: eq(projectPhotos.id, photoId) });
    expect(row).toMatchObject({ deletedAt: null, deletedById: null, visibleToClient: true });
    expect(files.size).toBe(2);
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

describe("setPhotoVisibility", () => {
  it("hides a photo from the client's app and shows it again; staff still see it", async () => {
    const { tenant, client, project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id, { chapterCode: "05" });

    await svc.setPhotoVisibility(ctx, project.id, photoId, { visibleToClient: false });
    expect(await svc.listClientPhotos(tenant.id, client.id)).toEqual([]);
    await expect(svc.openClientPhoto(tenant.id, client.id, photoId)).rejects.toMatchObject({ code: "not_found" });
    expect((await svc.photosByChapter(tenant.id, project.id)).size).toBe(0);
    expect((await svc.listPhotos(ctx, project.id))[0]).toMatchObject({ id: photoId, visibleToClient: false });
    expect((await svc.openPhoto(ctx, project.id, photoId)).contentType).toBe("image/jpeg");

    await svc.setPhotoVisibility(ctx, project.id, photoId, { visibleToClient: true });
    expect((await svc.listClientPhotos(tenant.id, client.id)).map((p) => p.id)).toEqual([photoId]);
    expect([...(await svc.photosByChapter(tenant.id, project.id)).keys()]).toEqual(["05"]);
  });

  it("is for editors of the photo's own tenant", async () => {
    const { tenant, project, ctx } = await setup();
    const photo = await createTestPhoto(tenant.id, project.id);
    const other = await setup();

    await expect(svc.setPhotoVisibility({ ...ctx, role: "manager" }, project.id, photo.id, { visibleToClient: false })).resolves.toEqual({ photoId: photo.id });
    await expect(svc.setPhotoVisibility({ ...ctx, role: "viewer" }, project.id, photo.id, { visibleToClient: false })).rejects.toMatchObject({ code: "forbidden" });
    await expect(svc.setPhotoVisibility(other.ctx, project.id, photo.id, { visibleToClient: false })).rejects.toMatchObject({ code: "project_not_found" });
    await expect(svc.setPhotoVisibility(other.ctx, other.project.id, photo.id, { visibleToClient: false })).rejects.toMatchObject({ code: "not_found" });
    await expect(svc.setPhotoVisibility(ctx, project.id, photo.id, { visibleToClient: "yes" })).rejects.toMatchObject({ code: "missing_fields" });
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
  it("keeps the project's photos and their stored files, out of reach", async () => {
    const { project, ctx, tenant, client } = await setup();
    const { photoId } = await upload(ctx, project.id);
    const other = await setup();
    await upload(other.ctx, other.project.id);
    const stored = [...files.keys()];

    await projectsService.deleteProject(ctx, project.id);

    // Nothing is erased: each project's photo and thumbnail, and the photo's row.
    expect([...files.keys()]).toEqual(stored);
    expect(stored.filter((pathname) => pathname.includes(project.id))).toHaveLength(2);
    expect(stored.filter((pathname) => pathname.includes(other.project.id))).toHaveLength(2);
    expect(await db.select({ id: projectPhotos.id }).from(projectPhotos).where(eq(projectPhotos.projectId, project.id))).toEqual([
      { id: photoId },
    ]);
    // But staff can't list or add to them, and the client no longer has them.
    await expect(svc.listPhotos(ctx, project.id)).rejects.toMatchObject({ code: "project_not_found", status: 404 });
    await expect(upload(ctx, project.id)).rejects.toMatchObject({ code: "project_not_found", status: 404 });
    expect(await svc.listClientPhotos(tenant.id, client.id)).toEqual([]);
    await expect(svc.openClientPhoto(tenant.id, client.id, photoId)).rejects.toMatchObject({ code: "not_found", status: 404 });
    expect([...files.keys()]).toEqual(stored);
    // The other project's are untouched.
    expect(await svc.listPhotos(other.ctx, other.project.id)).toHaveLength(1);
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

describe("input boundaries (schemas in src/inputs/projects.ts)", () => {
  it.each([
    // The day first, then the file, as before.
    ["invalid_date", { takenOn: 20260302, file: undefined }],
    ["invalid_date", { takenOn: true }],
    ["missing_file", { file: "foto.jpg" }],
    ["missing_file", { file: new File([], "vacía.jpg") }],
  ])("addPhoto answers %s and stores nothing", async (code, overrides) => {
    const { project, ctx } = await setup();
    await expect(upload(ctx, project.id, overrides)).rejects.toMatchObject({ code, status: 400 });
    expect(await db.select().from(projectPhotos)).toHaveLength(0);
  });

  it("addPhoto: an empty day is none, texts that aren't text are blank; extra keys are ignored", async () => {
    const { tenant, project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id, { takenOn: "", caption: 5, chapterCode: null, tenantId: "other", visibleToClient: false });
    const row = await db.query.projectPhotos.findFirst({ where: eq(projectPhotos.id, photoId) });
    expect(row).toMatchObject({ tenantId: tenant.id, takenOn: null, caption: null, chapterCode: null, visibleToClient: true });
  });

  it("setPhotoVisibility: anything but a boolean is missing_fields, before the project is looked for", async () => {
    const { project, ctx } = await setup();
    const { photoId } = await upload(ctx, project.id);
    for (const visibleToClient of [undefined, "true", 1]) {
      await expect(svc.setPhotoVisibility(ctx, "no-such-project", photoId, { visibleToClient })).rejects.toMatchObject({
        code: "missing_fields",
        status: 400,
      });
    }
  });
});
