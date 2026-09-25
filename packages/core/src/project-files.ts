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

/** Stores the file, then records it; the file is removed again if the row can't be. */
export async function storeFile(
  pathname: string,
  file: Blob,
  contentType: string,
  insertRow: () => Promise<unknown>,
) {
  await putFile(pathname, file, contentType);
  try {
    await insertRow();
  } catch (error) {
    await deleteFile(pathname).catch(() => {});
    throw error;
  }
}

/** File first: if that fails the row stays and the delete can be retried. */
export async function removeFile(pathname: string, deleteRow: () => Promise<unknown>) {
  await deleteFile(pathname);
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
