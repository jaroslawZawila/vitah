import { and, db, desc, eq, projectPhotos, projects, users } from "@repo/db";
import type { Ctx } from "./context";
import {
  MAX_CAPTION_LENGTH,
  MAX_PHOTO_BYTES,
  type MobilePhoto,
  type PhotoType,
  type ProjectPhoto,
} from "./contract";
import {
  fail,
  openStoredFile,
  projectFolder,
  removeFile,
  requireFileManager,
  requireProject,
  storeFile,
} from "./project-files";

// ─── Project photos ───────────────────────────────────────────────────────────
// Site photos staff share with a project's client (see ./project-files for who
// may do what). The client sees their own project's photos in the mobile app.
// ─────────────────────────────────────────────────────────────────────────────

const EXTENSIONS: Record<PhotoType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** The image type from the file's magic bytes; the browser-supplied type can't be trusted. */
async function sniffType(file: Blob): Promise<PhotoType | null> {
  const b = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const ascii = (from: number, to: number) => String.fromCharCode(...b.slice(from, to));
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (ascii(0, 8) === "\x89PNG\r\n\x1a\n") return "image/png";
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  return null;
}

function photoInProject(ctx: Ctx, projectId: string, photoId: string) {
  return and(
    eq(projectPhotos.id, photoId),
    eq(projectPhotos.projectId, projectId),
    eq(projectPhotos.tenantId, ctx.tenantId),
  );
}

const mobileColumns = {
  id: projectPhotos.id,
  caption: projectPhotos.caption,
  sizeBytes: projectPhotos.sizeBytes,
  createdAt: projectPhotos.createdAt,
};

type PhotoRow = Omit<MobilePhoto, "uploadedAt"> & { createdAt: Date };

function toMobilePhoto({ createdAt, ...photo }: PhotoRow): MobilePhoto {
  return { ...photo, uploadedAt: createdAt.toISOString() };
}

/** Body (multipart form): { file, caption? } — file is a JPEG, PNG or WebP of at most 4 MB. */
export async function addPhoto(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  requireFileManager(ctx);

  const { file } = input;
  const caption =
    typeof input.caption === "string" ? input.caption.trim().slice(0, MAX_CAPTION_LENGTH) : "";
  if (!(file instanceof Blob) || file.size === 0) fail("missing_file");
  if (file.size > MAX_PHOTO_BYTES) fail("file_too_large");
  const contentType = await sniffType(file);
  if (!contentType) fail("invalid_file_type");
  await requireProject(ctx.tenantId, projectId);

  const id = crypto.randomUUID();
  const pathname = `${projectFolder(ctx.tenantId, projectId)}photos/${id}.${EXTENSIONS[contentType]}`;
  await storeFile(pathname, file, contentType, () =>
    db.insert(projectPhotos).values({
      id,
      tenantId: ctx.tenantId,
      projectId,
      caption: caption || null,
      pathname,
      contentType,
      sizeBytes: file.size,
      uploadedById: ctx.userId,
    }),
  );

  return { photoId: id };
}

export async function listPhotos(ctx: Ctx, projectId: string): Promise<ProjectPhoto[]> {
  const [, rows] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    db
      .select({ ...mobileColumns, uploaderName: users.name, uploaderEmail: users.email })
      .from(projectPhotos)
      .leftJoin(users, eq(users.id, projectPhotos.uploadedById))
      .where(
        and(eq(projectPhotos.projectId, projectId), eq(projectPhotos.tenantId, ctx.tenantId)),
      )
      .orderBy(desc(projectPhotos.createdAt)),
  ]);

  return rows.map(({ uploaderName, uploaderEmail, ...photo }) => ({
    ...toMobilePhoto(photo),
    uploadedBy: uploaderName ?? uploaderEmail,
  }));
}

export async function deletePhoto(ctx: Ctx, projectId: string, photoId: string) {
  requireFileManager(ctx);

  const where = photoInProject(ctx, projectId, photoId);
  const photo = await db.query.projectPhotos.findFirst({ where, columns: { pathname: true } });
  if (!photo) fail("not_found");

  await removeFile(photo.pathname, () => db.delete(projectPhotos).where(where));

  return { photoId };
}

const fileColumns = {
  contentType: projectPhotos.contentType,
  sizeBytes: projectPhotos.sizeBytes,
  pathname: projectPhotos.pathname,
};

function openFile(photo: { contentType: string; sizeBytes: number; pathname: string } | undefined) {
  if (!photo) fail("not_found");
  // The stored name: "<photo id>.<ext>".
  const filename = photo.pathname.slice(photo.pathname.lastIndexOf("/") + 1);
  return openStoredFile({ ...photo, filename });
}

/** A photo's image, for staff of the project's tenant. */
export async function openPhoto(ctx: Ctx, projectId: string, photoId: string) {
  const [photo] = await db
    .select(fileColumns)
    .from(projectPhotos)
    .where(photoInProject(ctx, projectId, photoId));
  return openFile(photo);
}

// ─── Mobile app ──────────────────────────────────────────────────────────────
// Called with the client's own identity (from their mobile token). A client
// only ever reaches photos of the project they're attached to.

function clientProject(tenantId: string, clientUserId: string) {
  return and(
    eq(projects.id, projectPhotos.projectId),
    eq(projects.tenantId, tenantId),
    eq(projects.clientUserId, clientUserId),
  );
}

export async function listClientPhotos(
  tenantId: string,
  clientUserId: string,
): Promise<MobilePhoto[]> {
  const rows = await db
    .select(mobileColumns)
    .from(projectPhotos)
    .innerJoin(projects, clientProject(tenantId, clientUserId))
    .orderBy(desc(projectPhotos.createdAt));
  return rows.map(toMobilePhoto);
}

export async function openClientPhoto(tenantId: string, clientUserId: string, photoId: string) {
  const [photo] = await db
    .select(fileColumns)
    .from(projectPhotos)
    .innerJoin(projects, clientProject(tenantId, clientUserId))
    .where(eq(projectPhotos.id, photoId));
  return openFile(photo);
}
