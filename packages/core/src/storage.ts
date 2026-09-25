import { del, get, list, put } from "@vercel/blob";

// File storage for project documents: a private Vercel Blob store. Files have
// no public URL; they are only read back through our authenticated API.
// Credentials come from BLOB_READ_WRITE_TOKEN (local) or the store connected
// to the Vercel project. Tests swap this module for `@repo/core/testing`.

export async function putFile(pathname: string, body: Blob, contentType: string) {
  await put(pathname, body, { access: "private", contentType, addRandomSuffix: false });
}

/** The file's contents, or null if it doesn't exist. */
export async function readFile(pathname: string): Promise<ReadableStream<Uint8Array> | null> {
  const result = await get(pathname, { access: "private" });
  return result?.statusCode === 200 ? result.stream : null;
}

export async function deleteFile(pathname: string) {
  await del(pathname);
}

/** Deletes every file whose pathname starts with `prefix`. */
export async function deleteFolder(prefix: string) {
  let cursor: string | undefined;
  do {
    const page = await list({ prefix, cursor });
    if (page.blobs.length > 0) await del(page.blobs.map((blob) => blob.url));
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
}
