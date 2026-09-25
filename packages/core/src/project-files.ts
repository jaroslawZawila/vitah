import { db } from "@repo/db";
import type { Ctx } from "./context";
import type { DocumentError, PhotoError } from "./contract";
import { CoreError } from "./errors";
import { projectInTenant } from "./project-client";
import { deleteFile, putFile, readFile } from "./storage";

// ─── Project files ────────────────────────────────────────────────────────────
// What documents and photos share: files staff share with a project's client,
// kept in the private Blob store under the project's folder. Admins and
// managers upload and delete them; every staff member can list and view them.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS: Record<DocumentError | PhotoError, number> = {
  missing_fields: 400,
  missing_file: 400,
  invalid_category: 400,
  invalid_file_type: 400,
  file_too_large: 413,
  project_not_found: 404,
  not_found: 404,
  forbidden: 403,
};

export function fail(code: DocumentError | PhotoError): never {
  throw new CoreError(code, STATUS[code]);
}

/** Where a project's files live; everything under it belongs to the project. */
export const projectFolder = (tenantId: string, projectId: string) =>
  `tenants/${tenantId}/projects/${projectId}/`;

/** Admins and managers upload and delete; other roles only read. */
export function canManageProjectFiles(role: Ctx["role"]) {
  return role === "admin" || role === "manager";
}

export function requireFileManager(ctx: Ctx) {
  if (!canManageProjectFiles(ctx.role)) fail("forbidden");
}

export async function requireProject(tenantId: string, projectId: string) {
  const project = await db.query.projects.findFirst({
    where: projectInTenant(tenantId, projectId),
    columns: { id: true },
  });
  if (!project) fail("project_not_found");
}

type NewFile = { pathname: string; body: Blob; contentType: string };

/** Stores a row's files, then records it; the files are removed again if anything fails. */
export async function storeFiles(files: NewFile[], insertRow: () => Promise<unknown>) {
  try {
    // allSettled: clean up only once every upload has stopped, or one still
    // in flight could land after its delete and be orphaned.
    const puts = await Promise.allSettled(
      files.map((f) => putFile(f.pathname, f.body, f.contentType)),
    );
    const failed = puts.find((put) => put.status === "rejected");
    if (failed) throw failed.reason;
    await insertRow();
  } catch (error) {
    await Promise.all(files.map((f) => deleteFile(f.pathname).catch(() => {})));
    throw error;
  }
}

/** Files first: if that fails the row stays and the delete can be retried. */
export async function removeFiles(pathnames: string[], deleteRow: () => Promise<unknown>) {
  await Promise.all(pathnames.map(deleteFile));
  await deleteRow();
}

/** A stored file, ready to stream to the caller. */
export type StoredFile = {
  filename: string;
  contentType: string;
  sizeBytes: number;
  body: ReadableStream<Uint8Array>;
};

/** Opens the file of a row found by the caller's scoped query. */
export async function openStoredFile(
  file: Omit<StoredFile, "body"> & { pathname: string },
): Promise<StoredFile> {
  const body = await readFile(file.pathname);
  if (!body) fail("not_found");
  const { pathname: _, ...meta } = file;
  return { ...meta, body };
}
