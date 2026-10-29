import { and, db, eq, isNull, projectDocuments, projectPhotos, type SQL } from "@repo/db";
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
  budget_document: 409,
  generation_running: 409,
  missing_fields: 400,
  missing_file: 400,
  invalid_date: 400,
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

/**
 * Marks the visible document or photo `where` picks as notified, so its client
 * is pushed about it once only, however often it is hidden and shown again.
 * True for the one caller that should push.
 */
export async function claimFirstShown(table: typeof projectDocuments | typeof projectPhotos, where: SQL | undefined) {
  const claimed = await db
    .update(table)
    .set({ clientNotifiedAt: new Date() })
    .where(and(where, eq(table.visibleToClient, true), isNull(table.clientNotifiedAt)))
    .returning({ id: table.id });
  return claimed.length > 0;
}

/** Whether the file really is a PDF: the browser-supplied type can't be trusted. */
export async function isPdf(file: Blob) {
  return (await file.slice(0, 5).text()) === "%PDF-";
}

/** Where a project's files live; everything under it belongs to the project. */
export const projectFolder = (tenantId: string, projectId: string) =>
  `tenants/${tenantId}/projects/${projectId}/`;


/** The project, if it is in the tenant, with what the obra needs of it. */
export async function requireProject(tenantId: string, projectId: string) {
  const project = await db.query.projects.findFirst({
    where: projectInTenant(tenantId, projectId),
    columns: { id: true, ref: true, obraStage: true, startDate: true, completionDate: true },
  });
  if (!project) fail("project_not_found");
  return project;
}

/** An uploaded file's own name (≤ 200 characters), else `fallback`. */
export const uploadedName = (file: Blob, fallback: string) =>
  (file instanceof File && file.name ? file.name : fallback).slice(0, 200);

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

/** A stored file's bytes, or null if it isn't there (the budget's AI and the purchase documents' review read whole files). */
export async function readStoredBytes(pathname: string): Promise<Uint8Array<ArrayBuffer> | null> {
  const stream = await readFile(pathname);
  return stream ? new Uint8Array(await new Response(stream).arrayBuffer()) : null;
}
