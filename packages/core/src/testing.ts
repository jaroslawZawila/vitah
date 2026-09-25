// In-memory stand-in for ./storage, for tests in any package:
//   vi.mock("@repo/core/storage", () => import("@repo/core/testing"));

/** Stored files by pathname. Clear it between tests. */
export const files = new Map<string, Blob>();

export async function putFile(pathname: string, body: Blob, _contentType: string) {
  files.set(pathname, body);
}

export async function readFile(pathname: string) {
  return files.get(pathname)?.stream() ?? null;
}

export async function deleteFile(pathname: string) {
  files.delete(pathname);
}

export async function deleteFolder(prefix: string) {
  for (const pathname of [...files.keys()]) {
    if (pathname.startsWith(prefix)) files.delete(pathname);
  }
}

/** A real image for upload tests, e.g. `await testImage("png", 1600, 1200)`. */
export async function testImage(
  format: "jpeg" | "png" | "webp" = "jpeg",
  width = 1600,
  height = 1200,
) {
  const { default: sharp } = await import("sharp");
  const bytes = await sharp({
    create: { width, height, channels: 3, background: { r: 107, g: 122, b: 74 } },
  })
    .toFormat(format)
    .toBuffer();
  return new File([new Uint8Array(bytes)], `obra.${format === "jpeg" ? "jpg" : format}`, {
    type: `image/${format}`,
  });
}
