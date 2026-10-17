import {
  and,
  budgetGenerations,
  budgetRevisions,
  db,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  projectDocuments,
  projects,
  sql,
  users,
} from "@repo/db";
import { markChanged } from "./changes";
import { requireEditor, type Ctx } from "./context";
import {
  ACTIVE_GENERATION_STATUSES,
  BUDGET_INPUTS,
  BUDGET_INPUT_EXTENSIONS,
  fileTypeOf,
  DOCUMENT_CATEGORIES,
  MAX_CAPTION_LENGTH,
  MAX_DIRECT_UPLOAD_BYTES,
  MAX_DOCUMENT_BYTES,
  type BudgetInput,
  type BudgetPdfKind,
  type DocumentCategory,
  type MobileDocument,
  type ProjectDocument,
} from "./contract";
import { clippedText } from "./input";
import { notifyProjectClient } from "./notifications";
import {
  fail,
  isPdf,
  openStoredFile,
  projectFolder,
  removeFiles,
  requireProject,
  storeFiles,
} from "./project-files";
import { fileInfo, readFile } from "./storage";

// ─── Project documents ────────────────────────────────────────────────────────
// Files of a project (see ./project-files for who may do what). Staff choose
// which ones the client sees in the mobile app (`visible_to_client`). The
// budget adds two kinds that can't simply be deleted here: the documents it
// was generated from (staff-only, any of BUDGET_INPUT_TYPES, uploaded straight
// to the store) and the PDFs of each issued revision.
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

/** Fails unless `file` is a PDF we accept: present, at most 4 MB, starting with %PDF-. */
export async function requirePdf(file: unknown): Promise<Blob> {
  if (!(file instanceof Blob) || file.size === 0) fail("missing_file");
  if (file.size > MAX_DOCUMENT_BYTES) fail("file_too_large");
  if (!(await isPdf(file))) fail("invalid_file_type");
  return file;
}

type NewDocument = Pick<typeof projectDocuments.$inferInsert, "title" | "category"> &
  Partial<Pick<typeof projectDocuments.$inferInsert, "visibleToClient" | "budgetRevisionId" | "budgetPdf">>;

/**
 * A new PDF document: the file to store and the row to insert, kept apart so
 * the caller can insert the row in its own transaction (`storeFiles` deletes
 * the file again if that fails).
 */
export function newPdfDocument(ctx: Ctx, projectId: string, body: Blob, doc: NewDocument) {
  const id = crypto.randomUUID();
  const pathname = `${projectFolder(ctx.tenantId, projectId)}${id}.pdf`;
  return {
    file: { pathname, body, contentType: "application/pdf" },
    row: { ...doc, id, tenantId: ctx.tenantId, projectId, pathname, sizeBytes: body.size, uploadedById: ctx.userId },
  };
}

/** Body (multipart form): { title, category, file } — file is a PDF of at most 4 MB. */
export async function addDocument(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  requireEditor(ctx);

  const { category } = input;
  const title = clippedText(input.title, MAX_CAPTION_LENGTH);
  if (!(input.file instanceof Blob) || input.file.size === 0) fail("missing_file");
  if (!title) fail("missing_fields");
  if (!isCategory(category)) fail("invalid_category");
  const file = await requirePdf(input.file);
  await requireProject(ctx.tenantId, projectId);

  const { file: stored, row } = newPdfDocument(ctx, projectId, file, { title, category });
  await storeFiles([stored], () => db.insert(projectDocuments).values(row));
  await markChanged(ctx.tenantId, projectId, ["documents"]);
  await notifyProjectClient(ctx.tenantId, projectId, { kind: "document", title });

  return { documentId: row.id };
}

export async function listDocuments(ctx: Ctx, projectId: string): Promise<ProjectDocument[]> {
  const [, rows] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    db
      .select({
        ...mobileColumns,
        visibleToClient: projectDocuments.visibleToClient,
        contentType: projectDocuments.contentType,
        filename: projectDocuments.filename,
        budgetInput: projectDocuments.budgetInput,
        budgetPdf: projectDocuments.budgetPdf,
        uploaderName: users.name,
        uploaderEmail: users.email,
      })
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

  return rows.map(({ uploaderName, uploaderEmail, visibleToClient, contentType, filename, budgetInput, budgetPdf, ...mobile }) => ({
    ...toMobileDocument(mobile),
    uploadedBy: uploaderName ?? uploaderEmail,
    visibleToClient,
    contentType,
    filename,
    budgetInput,
    budgetPdf,
  }));
}

export async function deleteDocument(ctx: Ctx, projectId: string, documentId: string) {
  requireEditor(ctx);

  const where = documentInProject(ctx, projectId, documentId);
  const doc = await db.query.projectDocuments.findFirst({
    where,
    columns: { pathname: true, budgetInput: true, budgetRevisionId: true },
  });
  if (!doc) fail("not_found");
  // A revision's PDFs are what was sent; a budget's inputs are what the AI
  // read. Inputs can still be swapped while there is no budget and no AI run.
  if (doc.budgetRevisionId) fail("budget_document");
  if (doc.budgetInput) {
    const [budget, generation] = await Promise.all([
      db.query.budgetRevisions.findFirst({
        where: eq(budgetRevisions.projectId, projectId),
        columns: { id: true },
      }),
      db.query.budgetGenerations.findFirst({
        where: and(
          eq(budgetGenerations.projectId, projectId),
          inArray(budgetGenerations.status, ACTIVE_GENERATION_STATUSES),
          sql`${documentId} = any(${budgetGenerations.documentIds})`,
        ),
        columns: { id: true },
      }),
    ]);
    if (budget) fail("budget_document");
    if (generation) fail("generation_running");
  }

  await removeFiles([doc.pathname], () => db.delete(projectDocuments).where(where));
  await markChanged(ctx.tenantId, projectId, ["documents"]);

  return { documentId };
}

/**
 * Shows a document to the project's client, or hides it. The app only opens
 * PDFs it can download, so a budget input that isn't one (a spreadsheet, a
 * BC3, an image) or is over 4 MB stays staff-only. Body: { visibleToClient }
 */
export async function setDocumentVisibility(
  ctx: Ctx,
  projectId: string,
  documentId: string,
  input: Record<string, unknown>,
) {
  requireEditor(ctx);
  if (typeof input.visibleToClient !== "boolean") fail("missing_fields");
  await requireProject(ctx.tenantId, projectId);
  const where = documentInProject(ctx, projectId, documentId);
  if (input.visibleToClient) {
    const found = await db.query.projectDocuments.findFirst({ where, columns: { contentType: true, sizeBytes: true } });
    if (!found) fail("not_found");
    if (found.contentType !== "application/pdf") fail("invalid_file_type");
    if (found.sizeBytes > MAX_DOCUMENT_BYTES) fail("file_too_large");
  }
  const [doc] = await db
    .update(projectDocuments)
    .set({ visibleToClient: input.visibleToClient, updatedAt: new Date() })
    .where(where)
    .returning({ title: projectDocuments.title });
  if (!doc) fail("not_found");
  await markChanged(ctx.tenantId, projectId, ["documents"]);
  if (input.visibleToClient) {
    await notifyProjectClient(ctx.tenantId, projectId, { kind: "document", title: doc.title });
  }
  return { documentId };
}

// ─── Budget inputs ────────────────────────────────────────────────────────────
// Plans and project PDFs are often far over the 4 MB our functions accept, so
// the browser uploads them straight to the store (TECH_DESIGN §8): the portal
// asks for a pathname here, uploads, then registers the file.

/** The file type of a budget input, from its name ("planos.pdf" → pdf); null if not allowed. */
const inputType = (filename: string) => fileTypeOf(filename, BUDGET_INPUT_EXTENSIONS);

const inputsFolder = (tenantId: string, projectId: string) => `${projectFolder(tenantId, projectId)}inputs/`;

/** Where the browser may upload a budget input of this project, and what it may be. */
export async function budgetInputUpload(ctx: Ctx, projectId: string, filename: string) {
  requireEditor(ctx);
  await requireProject(ctx.tenantId, projectId);
  const type = inputType(filename);
  if (!type) fail("invalid_file_type");
  return { pathname: `${inputsFolder(ctx.tenantId, projectId)}${crypto.randomUUID()}.${type.extension}` };
}

/**
 * Lets the browser upload to `pathname` (TECH_DESIGN §8): only a fresh file
 * under this project's inputs folder, of an allowed type, up to the size cap.
 * The type is checked again, on the content, when the file is registered.
 */
export async function authorizeBudgetInputUpload(ctx: Ctx, projectId: string, pathname: string) {
  requireEditor(ctx);
  await requireProject(ctx.tenantId, projectId);
  const folder = inputsFolder(ctx.tenantId, projectId);
  const name = pathname.slice(folder.length);
  if (!pathname.startsWith(folder) || !/^[\w-]+\.\w+$/.test(name) || !inputType(name)) fail("invalid_file_type");
  return { maximumSizeInBytes: MAX_DIRECT_UPLOAD_BYTES, addRandomSuffix: false, allowOverwrite: false };
}

/** Whether a stored file starts with `magic` (the browser-supplied type can't be trusted). */
async function startsWith(pathname: string, magic: string) {
  const stream = await readFile(pathname);
  if (!stream) return false;
  const reader = stream.getReader();
  const { value } = await reader.read();
  await reader.cancel();
  return new TextDecoder().decode(value?.slice(0, magic.length)) === magic;
}

/**
 * Records a budget input the browser has uploaded to the pathname
 * `budgetInputUpload` gave it. Staff-only.
 * Body: { pathname, budgetInput, filename, title? }
 */
export async function registerBudgetInput(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  await requireProject(ctx.tenantId, projectId);
  const { pathname, budgetInput } = input;
  const filename = clippedText(input.filename, MAX_CAPTION_LENGTH);
  if (typeof pathname !== "string" || !filename) fail("missing_fields");
  if (!BUDGET_INPUTS.includes(budgetInput as BudgetInput)) fail("invalid_category");
  // Only a file this project's upload could have written.
  if (!pathname.startsWith(inputsFolder(ctx.tenantId, projectId))) fail("not_found");
  const type = inputType(filename);
  if (!type || !pathname.endsWith(`.${type.extension}`)) fail("invalid_file_type");
  const info = await fileInfo(pathname);
  if (!info) fail("missing_file");
  if (info.size > MAX_DIRECT_UPLOAD_BYTES) fail("file_too_large");
  if (type.extension === "pdf" && !(await startsWith(pathname, "%PDF-"))) fail("invalid_file_type");

  const title = clippedText(input.title, MAX_CAPTION_LENGTH) || filename.replace(/\.[^.]+$/, "");
  const [doc] = await db
    .insert(projectDocuments)
    .values({
      tenantId: ctx.tenantId,
      projectId,
      title,
      category: "budget",
      pathname,
      sizeBytes: info.size,
      visibleToClient: false,
      contentType: type.contentType,
      filename,
      budgetInput: budgetInput as BudgetInput,
      uploadedById: ctx.userId,
    })
    .onConflictDoNothing({ target: projectDocuments.pathname })
    .returning({ id: projectDocuments.id });
  if (!doc) fail("not_found");
  return { documentId: doc.id };
}

/**
 * Uses a document already on the project (a PDF uploaded the normal way) as
 * one of its budget's inputs. It keeps its visibility. Body: { budgetInput }
 */
export async function markBudgetInput(ctx: Ctx, projectId: string, documentId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  if (!BUDGET_INPUTS.includes(input.budgetInput as BudgetInput)) fail("invalid_category");
  await requireProject(ctx.tenantId, projectId);
  const [doc] = await db
    .update(projectDocuments)
    .set({ budgetInput: input.budgetInput as BudgetInput, updatedAt: new Date() })
    .where(and(documentInProject(ctx, projectId, documentId), isNull(projectDocuments.budgetRevisionId)))
    .returning({ id: projectDocuments.id });
  if (!doc) fail("not_found");
  return { documentId };
}

/** The project's budget inputs among `ids` (for a generation; no ctx: the pipeline runs as the system). */
export async function budgetInputs(tenantId: string, projectId: string, ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(projectDocuments)
    .where(
      and(
        eq(projectDocuments.tenantId, tenantId),
        eq(projectDocuments.projectId, projectId),
        inArray(projectDocuments.id, ids),
        isNotNull(projectDocuments.budgetInput),
      ),
    );
}

/** Remembers a budget input's id in Claude's Files API, to reuse on a later generation. */
export async function setClaudeFileId(documentId: string, claudeFileId: string) {
  await db.update(projectDocuments).set({ claudeFileId }).where(eq(projectDocuments.id, documentId));
}

const fileColumns = {
  title: projectDocuments.title,
  sizeBytes: projectDocuments.sizeBytes,
  pathname: projectDocuments.pathname,
  contentType: projectDocuments.contentType,
  filename: projectDocuments.filename,
};

type FileRow = { title: string; sizeBytes: number; pathname: string; contentType: string; filename: string | null };

function openFile(doc: FileRow | undefined) {
  if (!doc) fail("not_found");
  const { title, filename, ...file } = doc;
  return openStoredFile({ ...file, filename: filename ?? `${title}.pdf` });
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
// only ever reaches the documents of the project they're attached to that
// staff made visible to them.

function clientProject(tenantId: string, clientUserId: string) {
  return and(
    eq(projects.id, projectDocuments.projectId),
    eq(projects.tenantId, tenantId),
    eq(projects.clientUserId, clientUserId),
    eq(projectDocuments.visibleToClient, true),
  );
}

/** The categories every installed app build knows; older builds don't ask for more. */
const FIRST_CATEGORIES: readonly string[] = ["contract", "plans", "certificates", "other"];

/**
 * The client's visible documents. `categories` are the ones the app knows
 * (it says so in `?categories=`); a document in another one is listed as
 * "other", or an older build would label it "undefined".
 */
export async function listClientDocuments(
  tenantId: string,
  clientUserId: string,
  categories: readonly string[] = FIRST_CATEGORIES,
): Promise<MobileDocument[]> {
  const rows = await db
    .select(mobileColumns)
    .from(projectDocuments)
    .innerJoin(projects, clientProject(tenantId, clientUserId))
    .orderBy(desc(projectDocuments.createdAt));
  return rows.map((row) => toMobileDocument(categories.includes(row.category) ? row : { ...row, category: "other" }));
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
