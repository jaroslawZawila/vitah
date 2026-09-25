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
