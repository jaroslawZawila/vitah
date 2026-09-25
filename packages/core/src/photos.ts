import { and, db, desc, eq, projectPhotos, projects, users } from "@repo/db";
import sharp from "sharp";
import type { Ctx } from "./context";
import {
  MAX_CAPTION_LENGTH,
  MAX_PHOTO_BYTES,
  PHOTO_TYPES,
  type MobilePhoto,
  type PhotoSize,
  type PhotoType,
  type ProjectPhoto,
} from "./contract";
import {
  fail,
  openStoredFile,
  projectFolder,
  removeFiles,
  requireFileManager,
  requireProject,
  storeFiles,
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

/** The small copy grids show. `px` is its longest side: sharp on a 3× phone's grid tile. */
const THUMBNAIL = { px: 800, contentType: "image/webp", extension: "webp" } as const;

/** A photo's thumbnail sits next to it: "<id>.jpg" → "<id>.thumb.webp". */
const thumbPath = (pathname: string) =>
  pathname.replace(/\.[^./]+$/, `.thumb.${THUMBNAIL.extension}`);

/**
 * Decodes the upload — the browser-supplied type can't be trusted — and makes
 * its thumbnail: upright (EXIF orientation applied), no metadata.
 */
async function readImage(file: Blob) {
  try {
    const image = sharp(Buffer.from(await file.arrayBuffer()));
    const { format } = await image.metadata();
    const contentType = PHOTO_TYPES.find((type) => type === `image/${format}`);
    if (!contentType) return null;
    const thumbnail = await image
      .rotate()
      .resize(THUMBNAIL.px, THUMBNAIL.px, { fit: "inside", withoutEnlargement: true })
      .webp({ quality: 70 })
      .toBuffer();
    // A view of the Buffer's bytes, not a copy.
    const bytes = new Uint8Array(thumbnail.buffer, thumbnail.byteOffset, thumbnail.length);
    return { contentType, thumbnail: new Blob([bytes]) };
  } catch {
    return null; // Not an image sharp can decode.
  }
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
  const [image] = await Promise.all([readImage(file), requireProject(ctx.tenantId, projectId)]);
  if (!image) fail("invalid_file_type");
  const { contentType, thumbnail } = image;

  const id = crypto.randomUUID();
  const folder = `${projectFolder(ctx.tenantId, projectId)}photos/`;
  const pathname = `${folder}${id}.${EXTENSIONS[contentType]}`;
  await storeFiles(
    [
      { pathname, body: file, contentType },
      { pathname: thumbPath(pathname), body: thumbnail, contentType: THUMBNAIL.contentType },
    ],
    () =>
      db.insert(projectPhotos).values({
        id,
        tenantId: ctx.tenantId,
        projectId,
        caption: caption || null,
        pathname,
        contentType,
        sizeBytes: file.size,
        thumbSizeBytes: thumbnail.size,
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
  const photo = await db.query.projectPhotos.findFirst({
    where,
    columns: { pathname: true, thumbSizeBytes: true },
  });
  if (!photo) fail("not_found");

  const { pathname, thumbSizeBytes } = photo;
  const pathnames = thumbSizeBytes === null ? [pathname] : [pathname, thumbPath(pathname)];
  await removeFiles(pathnames, () => db.delete(projectPhotos).where(where));

  return { photoId };
}

const fileColumns = {
  contentType: projectPhotos.contentType,
  sizeBytes: projectPhotos.sizeBytes,
  pathname: projectPhotos.pathname,
  thumbSizeBytes: projectPhotos.thumbSizeBytes,
};

type FileRow = Pick<
  typeof projectPhotos.$inferSelect,
  "contentType" | "sizeBytes" | "pathname" | "thumbSizeBytes"
>;

/**
 * Opens the photo or its thumbnail. Photos uploaded before thumbnails existed
 * (null `thumbSizeBytes`) have none, so grids get the original for those.
 */
function openFile(photo: FileRow | undefined, size: PhotoSize) {
  if (!photo) fail("not_found");
  const { pathname, contentType, sizeBytes, thumbSizeBytes } = photo;
  const file =
    size === "thumb" && thumbSizeBytes !== null
      ? {
          pathname: thumbPath(pathname),
          contentType: THUMBNAIL.contentType,
          sizeBytes: thumbSizeBytes,
        }
      : { pathname, contentType, sizeBytes };
  // The stored name: "<photo id>.<ext>" or "<photo id>.thumb.webp".
  const filename = file.pathname.slice(file.pathname.lastIndexOf("/") + 1);
  return openStoredFile({ ...file, filename });
}

/** A photo's image (or its thumbnail), for staff of the project's tenant. */
export async function openPhoto(
  ctx: Ctx,
  projectId: string,
  photoId: string,
  size: PhotoSize = "full",
) {
  const [photo] = await db
    .select(fileColumns)
    .from(projectPhotos)
    .where(photoInProject(ctx, projectId, photoId));
  return openFile(photo, size);
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

export async function openClientPhoto(
  tenantId: string,
  clientUserId: string,
  photoId: string,
  size: PhotoSize = "full",
) {
  const [photo] = await db
    .select(fileColumns)
    .from(projectPhotos)
    .innerJoin(projects, clientProject(tenantId, clientUserId))
    .where(eq(projectPhotos.id, photoId));
  return openFile(photo, size);
}
