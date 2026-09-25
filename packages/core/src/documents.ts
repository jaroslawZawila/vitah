import { and, db, desc, eq, projectDocuments, projects, users } from "@repo/db";
import type { Ctx } from "./context";
import {
  DOCUMENT_CATEGORIES,
  MAX_DOCUMENT_BYTES,
  type DocumentCategory,
  type DocumentError,
  type MobileDocument,
  type ProjectDocument,
} from "./contract";
import { CoreError } from "./errors";
import { projectInTenant } from "./project-client";
import { deleteFile, putFile, readFile } from "./storage";

// ─── Project documents ────────────────────────────────────────────────────────
// PDFs staff share with a project's client. Admins and managers upload and
// delete them; every staff member can list and download them. The client sees
// their own project's documents in the mobile app.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS: Record<DocumentError, number> = {
  missing_fields: 400,
  missing_file: 400,
  invalid_category: 400,
  invalid_file_type: 400,
  file_too_large: 413,
  project_not_found: 404,
  not_found: 404,
  forbidden: 403,
};

function fail(code: DocumentError): never {
  throw new CoreError(code, STATUS[code]);
}

/** Where a project's files live; everything under it belongs to the project. */
export const projectFolder = (tenantId: string, projectId: string) =>
  `tenants/${tenantId}/projects/${projectId}/`;

/** Admins and managers upload and delete; other roles only read. */
export function canManageDocuments(role: Ctx["role"]) {
  return role === "admin" || role === "manager";
}

function requireManager(ctx: Ctx) {
  if (!canManageDocuments(ctx.role)) fail("forbidden");
}

async function requireProject(tenantId: string, projectId: string) {
  const project = await db.query.projects.findFirst({
    where: projectInTenant(tenantId, projectId),
    columns: { id: true },
  });
  if (!project) fail("project_not_found");
}

function documentInProject(ctx: Ctx, projectId: string, documentId: string) {
  return and(
    eq(projectDocuments.id, documentId),
    eq(projectDocuments.projectId, projectId),
    eq(projectDocuments.tenantId, ctx.tenantId),
  );
}

function isCategory(value: unknown): value is DocumentCategory {
  return DOCUMENT_CATEGORIES.includes(value as DocumentCategory);
}

/** Checks the file's magic bytes; the browser-supplied type can't be trusted. */
async function isPdf(file: Blob) {
  return (await file.slice(0, 5).text()) === "%PDF-";
}

const mobileColumns = {
  id: projectDocuments.id,
  title: projectDocuments.title,
  category: projectDocuments.category,
  sizeBytes: projectDocuments.sizeBytes,
  createdAt: projectDocuments.createdAt,
};

type DocumentRow = Omit<MobileDocument, "uploadedAt"> & { createdAt: Date };

function toMobileDocument({ createdAt, ...doc }: DocumentRow): MobileDocument {
  return { ...doc, uploadedAt: createdAt.toISOString() };
}

/** Body (multipart form): { title, category, file } — file is a PDF of at most 4 MB. */
export async function addDocument(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  requireManager(ctx);

  const { file, category } = input;
  const title = typeof input.title === "string" ? input.title.trim() : "";
  if (!(file instanceof Blob) || file.size === 0) fail("missing_file");
  if (!title) fail("missing_fields");
  if (!isCategory(category)) fail("invalid_category");
  if (file.size > MAX_DOCUMENT_BYTES) fail("file_too_large");
  if (!(await isPdf(file))) fail("invalid_file_type");
  await requireProject(ctx.tenantId, projectId);

  const id = crypto.randomUUID();
  const pathname = `${projectFolder(ctx.tenantId, projectId)}${id}.pdf`;
  await putFile(pathname, file, "application/pdf");
  try {
    await db.insert(projectDocuments).values({
      id,
      tenantId: ctx.tenantId,
      projectId,
      title,
      category,
      pathname,
      sizeBytes: file.size,
      uploadedById: ctx.userId,
    });
  } catch (error) {
    await deleteFile(pathname).catch(() => {});
    throw error;
  }

  return { documentId: id };
}

export async function listDocuments(ctx: Ctx, projectId: string): Promise<ProjectDocument[]> {
  const [, rows] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    db
      .select({ ...mobileColumns, uploaderName: users.name, uploaderEmail: users.email })
      .from(projectDocuments)
      .leftJoin(users, eq(users.id, projectDocuments.uploadedById))
      .where(
        and(
          eq(projectDocuments.projectId, projectId),
          eq(projectDocuments.tenantId, ctx.tenantId),
        ),
      )
      .orderBy(desc(projectDocuments.createdAt)),
  ]);

  return rows.map(({ uploaderName, uploaderEmail, ...doc }) => ({
    ...toMobileDocument(doc),
    uploadedBy: uploaderName ?? uploaderEmail,
  }));
}

export async function deleteDocument(ctx: Ctx, projectId: string, documentId: string) {
  requireManager(ctx);

  const where = documentInProject(ctx, projectId, documentId);
  const doc = await db.query.projectDocuments.findFirst({ where, columns: { pathname: true } });
  if (!doc) fail("not_found");

  // File first: if that fails the row stays and the delete can be retried.
  await deleteFile(doc.pathname);
  await db.delete(projectDocuments).where(where);

  return { documentId };
}

export type DocumentFile = {
  title: string;
  sizeBytes: number;
  body: ReadableStream<Uint8Array>;
};

const fileColumns = {
  title: projectDocuments.title,
  sizeBytes: projectDocuments.sizeBytes,
  pathname: projectDocuments.pathname,
};

async function openFile(
  doc: { title: string; sizeBytes: number; pathname: string } | undefined,
): Promise<DocumentFile> {
  if (!doc) fail("not_found");
  const body = await readFile(doc.pathname);
  if (!body) fail("not_found");
  return { title: doc.title, sizeBytes: doc.sizeBytes, body };
}

/** A document's file, for staff of the project's tenant. */
export async function openDocument(ctx: Ctx, projectId: string, documentId: string) {
  const [doc] = await db
    .select(fileColumns)
    .from(projectDocuments)
    .where(documentInProject(ctx, projectId, documentId));
  return openFile(doc);
}

// ─── Mobile app ──────────────────────────────────────────────────────────────
// Called with the client's own identity (from their mobile token). A client
// only ever reaches documents of the project they're attached to.

function clientProject(tenantId: string, clientUserId: string) {
  return and(
    eq(projects.id, projectDocuments.projectId),
    eq(projects.tenantId, tenantId),
    eq(projects.clientUserId, clientUserId),
  );
}

export async function listClientDocuments(
  tenantId: string,
  clientUserId: string,
): Promise<MobileDocument[]> {
  const rows = await db
    .select(mobileColumns)
    .from(projectDocuments)
    .innerJoin(projects, clientProject(tenantId, clientUserId))
    .orderBy(desc(projectDocuments.createdAt));
  return rows.map(toMobileDocument);
}

export async function openClientDocument(
  tenantId: string,
  clientUserId: string,
  documentId: string,
) {
  const [doc] = await db
    .select(fileColumns)
    .from(projectDocuments)
    .innerJoin(projects, clientProject(tenantId, clientUserId))
    .where(eq(projectDocuments.id, documentId));
  return openFile(doc);
}
