import { and, db, desc, eq, projectDocuments, projects, users } from "@repo/db";
import type { Ctx } from "./context";
import {
  DOCUMENT_CATEGORIES,
  MAX_DOCUMENT_BYTES,
  type DocumentCategory,
  type MobileDocument,
  type ProjectDocument,
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

// ─── Project documents ────────────────────────────────────────────────────────
// PDFs staff share with a project's client (see ./project-files for who may
// do what). The client sees their own project's documents in the mobile app.
// ─────────────────────────────────────────────────────────────────────────────

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
  requireFileManager(ctx);

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
  await storeFile(pathname, file, "application/pdf", () =>
    db.insert(projectDocuments).values({
      id,
      tenantId: ctx.tenantId,
      projectId,
      title,
      category,
      pathname,
      sizeBytes: file.size,
      uploadedById: ctx.userId,
    }),
  );

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
  requireFileManager(ctx);

  const where = documentInProject(ctx, projectId, documentId);
  const doc = await db.query.projectDocuments.findFirst({ where, columns: { pathname: true } });
  if (!doc) fail("not_found");

  await removeFile(doc.pathname, () => db.delete(projectDocuments).where(where));

  return { documentId };
}

const fileColumns = {
  title: projectDocuments.title,
  sizeBytes: projectDocuments.sizeBytes,
  pathname: projectDocuments.pathname,
};

function openFile(doc: { title: string; sizeBytes: number; pathname: string } | undefined) {
  if (!doc) fail("not_found");
  const { title, ...file } = doc;
  return openStoredFile({ ...file, filename: `${title}.pdf`, contentType: "application/pdf" });
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
