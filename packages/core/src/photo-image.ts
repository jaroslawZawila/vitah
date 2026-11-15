import { PHOTO_TYPES, type PhotoSize, type PhotoType } from "./contract";
import { fail, openStoredFile } from "./project-files";

// ─── Uploaded photos ─────────────────────────────────────────────────────────
// What every photo upload shares (a project's site photos, a warranty claim's):
// the image is decoded to know its real type, and stored with a small WebP
// copy next to it for grids.
// ─────────────────────────────────────────────────────────────────────────────

export const PHOTO_EXTENSIONS: Record<PhotoType, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** The small copy grids show. `px` is its longest side: sharp on a 3× phone's grid tile. */
export const THUMBNAIL = { px: 800, contentType: "image/webp", extension: "webp" } as const;

const MAX_PIXELS = 50_000_000;

/** A photo's thumbnail sits next to it: "<id>.jpg" → "<id>.thumb.webp". */
export const thumbPath = (pathname: string) => pathname.replace(/\.[^./]+$/, `.thumb.${THUMBNAIL.extension}`);

/**
 * Decodes the upload — the browser-supplied type can't be trusted — and makes
 * its thumbnail: upright (EXIF orientation applied), no metadata. Null when it
 * isn't a JPEG, PNG or WebP image.
 */
export async function readImage(file: Blob) {
  // Loaded on first upload, not with the module: @repo/core is imported by
  // every route (and the proxy), and sharp is a native library. If it can't
  // load, uploads fail with a server error; nothing else is affected.
  const { default: sharp } = await import("sharp");
  try {
    // A small file can decode to gigabytes (a "decompression bomb"): refuse
    // anything larger than a 48-megapixel camera's photo.
    const image = sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: MAX_PIXELS });
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

/** A stored photo's row: its file, and its thumbnail's size (null: none was made). */
export type PhotoFileRow = { contentType: string; sizeBytes: number; pathname: string; thumbSizeBytes: number | null };

/**
 * Opens the photo or its thumbnail, from the row the caller's scoped query
 * found (`not_found` without one). A photo without a thumbnail (uploaded
 * before they existed) gives the original for both.
 */
export function openPhotoFile(photo: PhotoFileRow | undefined, size: PhotoSize) {
  if (!photo) fail("not_found");
  const { pathname, contentType, sizeBytes, thumbSizeBytes } = photo;
  const file =
    size === "thumb" && thumbSizeBytes !== null
      ? { pathname: thumbPath(pathname), contentType: THUMBNAIL.contentType, sizeBytes: thumbSizeBytes }
      : { pathname, contentType, sizeBytes };
  // The stored name: "<photo id>.<ext>" or "<photo id>.thumb.webp".
  const filename = file.pathname.slice(file.pathname.lastIndexOf("/") + 1);
  return openStoredFile({ ...file, filename });
}
