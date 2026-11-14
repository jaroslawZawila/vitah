import {
  and,
  budgetRevisions,
  db,
  desc,
  eq,
  inArray,
  obraChapterProgress,
  obraHitoEvents,
  obraHitos,
  obraIssues,
  projectDocuments,
  projects,
  purchaseInvoices,
  purchaseOrders,
  sql,
  subcontractorAssignments,
} from "@repo/db";
import { fromCalendarDate, isCalendarDate } from "./calendar";
import { markChanged } from "./changes";
import { requireAdmin, requireEditor, type Ctx } from "./context";
import { CoreError, invalid, notFound } from "./errors";
import { MAX_TEXT, text } from "./input";
import { projectInTenant, requireAssignableClient, type Tx } from "./project-client";
import { projectFolder } from "./project-files";
import { deleteFolder } from "./storage";

// Every function here takes `ctx` and filters by `ctx.tenantId`.
// A project holds exactly what the client's mobile app shows.

// Input parsing: API bodies and form values arrive as unknown / strings.

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;

const MAX_REF = 40;
const MAX_ADDRESS = 300;

/**
 * A YYYY-MM-DD calendar date, stored at UTC midnight. A full ISO timestamp
 * (which /api/v1 accepted before) counts as its UTC date.
 * `undefined` = not provided, `null` = cleared (empty string or null).
 */
function date(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string") throw invalid("invalid_date");
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const parsed = ISO_TIMESTAMP.test(trimmed) ? new Date(trimmed) : null;
  const raw =
    parsed && !Number.isNaN(parsed.getTime()) && isCalendarDate(trimmed.slice(0, 10))
      ? parsed.toISOString().slice(0, 10)
      : trimmed;
  if (!isCalendarDate(raw)) throw invalid("invalid_date");
  return fromCalendarDate(raw);
}

function checkOrder(start: Date | null | undefined, completion: Date | null | undefined) {
  if (start && completion && completion < start) throw invalid("dates_out_of_order");
}

const clientColumns = { columns: { id: true, name: true, email: true } } as const;

// The change counters are the app's business (./changes), and the reviewed
// revision the Obra tab's (./construction): not part of the project.
const projectColumns = {
  obraReviewedRevisionId: false,
  projectRev: false,
  obraRev: false,
  photosRev: false,
  documentsRev: false,
} as const;

export async function listProjects(ctx: Ctx) {
  return db.query.projects.findMany({
    where: eq(projects.tenantId, ctx.tenantId),
    columns: projectColumns,
    with: { client: clientColumns },
    orderBy: [desc(projects.createdAt)],
  });
}

export async function getProject(ctx: Ctx, id: string) {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.tenantId, ctx.tenantId)),
    columns: projectColumns,
    with: { client: clientColumns },
  });
  return project ?? null;
}

export type ProjectListItem = Awaited<ReturnType<typeof listProjects>>[number];
export type ProjectDetail = NonNullable<Awaited<ReturnType<typeof getProject>>>;

/**
 * Body: { ref, address, startDate?, completionDate?, clientId? } — dates as
 * YYYY-MM-DD. `clientId` (admin only) attaches an existing, free client.
 */
export async function createProject(ctx: Ctx, input: Record<string, unknown>) {
  requireEditor(ctx);
  const ref = text(input.ref, MAX_REF);
  const address = text(input.address, MAX_ADDRESS);
  if (!ref || !address) throw invalid("missing_fields");
  const startDate = date(input.startDate) ?? null;
  const completionDate = date(input.completionDate) ?? null;
  checkOrder(startDate, completionDate);
  const clientId = text(input.clientId, MAX_TEXT) ?? null;
  if (clientId) requireAdmin(ctx);

  const existing = await db.query.projects.findFirst({
    where: and(eq(projects.tenantId, ctx.tenantId), eq(projects.ref, ref)),
    columns: { id: true },
  });
  if (existing) throw invalid("ref_exists");

  return db.transaction(async (tx) => {
    if (clientId) await requireAssignableClient(tx, ctx.tenantId, clientId);

    const [created] = await tx
      .insert(projects)
      .values({
        tenantId: ctx.tenantId,
        ref,
        address,
        startDate,
        completionDate,
        clientUserId: clientId,
      })
      .returning({ id: projects.id });
    if (!created) throw new Error("Project insert returned no row");

    return { id: created.id };
  });
}

/**
 * Partial update of { address, startDate, completionDate }. Unknown keys are
 * ignored; an empty date clears it.
 */
export async function updateProject(ctx: Ctx, id: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const set: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };

  if (input.address !== undefined) {
    const address = text(input.address, MAX_ADDRESS);
    if (!address) throw invalid("missing_fields");
    set.address = address;
  }
  const startDate = date(input.startDate);
  if (startDate !== undefined) set.startDate = startDate;
  const completionDate = date(input.completionDate);
  if (completionDate !== undefined) set.completionDate = completionDate;

  // Locked, so a concurrent edit of the other date can't slip past the order check.
  await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ startDate: projects.startDate, completionDate: projects.completionDate })
      .from(projects)
      .where(projectInTenant(ctx.tenantId, id))
      .for("update");
    if (!current) throw notFound();
    checkOrder(
      startDate === undefined ? current.startDate : startDate,
      completionDate === undefined ? current.completionDate : completionDate,
    );
    await tx.update(projects).set(set).where(projectInTenant(ctx.tenantId, id));
  });
  await markChanged(ctx.tenantId, id, ["project"]);

  return { projectId: id };
}

/**
 * Whether the project holds records the company must keep: a budget that left
 * draft, a placed order or a supplier's invoice, a hito's acta, invoice or
 * payment (or the history of one since undone), works recorded as started, a
 * contract among its documents, an incident or change logged, or a
 * subcontractor assigned to it (its entry in the Libro de Subcontratación). The rows are locked as they are read
 * (and compared here, not in SQL), so a budget being issued, an order being
 * placed or a payment being recorded waits for the delete and then finds nothing.
 */
async function hasRecordsToKeep(tx: Tx, projectId: string): Promise<boolean> {
  const revisions = await tx
    .select({ status: budgetRevisions.status })
    .from(budgetRevisions)
    .where(eq(budgetRevisions.projectId, projectId))
    .for("update");
  if (revisions.some((r) => r.status !== "draft")) return true;

  const orders = await tx
    .select({ id: purchaseOrders.id, status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.projectId, projectId))
    .for("update");
  if (orders.some((o) => o.status !== "pending" && o.status !== "cancelled")) return true;
  if (orders.length > 0) {
    const [invoice] = await tx
      .select({ id: purchaseInvoices.id })
      .from(purchaseInvoices)
      .where(inArray(purchaseInvoices.orderId, orders.map((o) => o.id)))
      .limit(1);
    if (invoice) return true;
  }

  const hitos = await tx
    .select({
      id: obraHitos.id,
      actaPathname: obraHitos.actaPathname,
      invoicePathname: obraHitos.invoicePathname,
      paidOn: obraHitos.paidOn,
    })
    .from(obraHitos)
    .where(eq(obraHitos.projectId, projectId))
    .for("update");
  if (hitos.some((h) => h.actaPathname || h.invoicePathname || h.paidOn)) return true;
  // Their history too: a payment registered and then cancelled is only there.
  if (hitos.length > 0) {
    const [event] = await tx
      .select({ id: obraHitoEvents.id })
      .from(obraHitoEvents)
      .where(inArray(obraHitoEvents.hitoId, hitos.map((h) => h.id)))
      .limit(1);
    if (event) return true;
  }

  // Nothing to lock below: each is there or it isn't, and a new one needs the
  // project's row, which the delete holds.
  const [[progress], [contract], [issue], [assignment]] = await Promise.all([
    tx
      .select({ id: obraChapterProgress.id })
      .from(obraChapterProgress)
      .where(eq(obraChapterProgress.projectId, projectId))
      .limit(1),
    tx
      .select({ id: projectDocuments.id })
      .from(projectDocuments)
      .where(and(eq(projectDocuments.projectId, projectId), eq(projectDocuments.category, "contract")))
      .limit(1),
    tx.select({ id: obraIssues.id }).from(obraIssues).where(eq(obraIssues.projectId, projectId)).limit(1),
    tx
      .select({ id: subcontractorAssignments.id })
      .from(subcontractorAssignments)
      .where(eq(subcontractorAssignments.projectId, projectId))
      .limit(1),
  ]);
  return Boolean(progress || contract || issue || assignment);
}

/** Postgres gave up on a lock: it wasn't free in time (55P03), or waiting for it would deadlock (40P01). */
function isLockFailure(error: unknown): boolean {
  // Drizzle wraps driver errors, keeping the original as `cause`.
  return [error, (error as { cause?: unknown } | null)?.cause].some(
    (e) => typeof e === "object" && e !== null && ["55P03", "40P01"].includes((e as { code?: string }).code ?? ""),
  );
}

/**
 * Deletes the project, its rows (cascade) and its stored files. Admin only,
 * and only while nothing has been issued, contracted, invoiced or collected:
 * `project_has_records` otherwise.
 */
export async function deleteProject(ctx: Ctx, id: string) {
  requireAdmin(ctx);
  const attempt = () =>
    db.transaction(async (tx) => {
      // A write to the project in flight locks its own row first and then, through
      // its foreign key, the project's: this goes the other way round, so it gives
      // up soon rather than deadlock with it.
      await tx.execute(sql`set local lock_timeout = '500ms'`);
      // Locked, so nothing new can be attached to the project meanwhile.
      const [project] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(projectInTenant(ctx.tenantId, id))
        .for("update");
      if (!project) throw notFound();
      if (await hasRecordsToKeep(tx, id)) throw new CoreError("project_has_records", 409);
      await tx.delete(projects).where(eq(projects.id, id));
    });
  try {
    await attempt();
  } catch (error) {
    if (!isLockFailure(error)) throw error;
    // Once more: that write is in by now, and what it wrote is usually a record to keep.
    await attempt().catch((again: unknown) => {
      throw isLockFailure(again) ? new CoreError("project_has_records", 409) : again;
    });
  }

  // The project is gone either way; a failure here only leaves orphaned files.
  await deleteFolder(projectFolder(ctx.tenantId, id)).catch((error: unknown) => {
    console.error("Failed to delete files of project", id, error);
  });
  return { projectId: id };
}
