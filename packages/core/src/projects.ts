import { db, projects, eq, and, desc } from "@repo/db";
import { fromCalendarDate, isCalendarDate } from "./calendar";
import { markChanged } from "./changes";
import { requireAdmin, requireEditor, type Ctx } from "./context";
import { invalid, notFound } from "./errors";
import { MAX_TEXT, text } from "./input";
import { clientConflict, projectInTenant, requireAssignableClient } from "./project-client";
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

// The change counters are the app's business (./changes), not staff's.
const projectColumns = {
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

  try {
    return await db.transaction(async (tx) => {
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
  } catch (error) {
    throw clientConflict(error);
  }
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

/** Deletes the project, its rows (cascade) and its stored files. Admin only. */
export async function deleteProject(ctx: Ctx, id: string) {
  requireAdmin(ctx);
  const deleted = await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.tenantId, ctx.tenantId)))
    .returning({ id: projects.id });
  if (deleted.length === 0) throw notFound();

  // The project is gone either way; a failure here only leaves orphaned files.
  await deleteFolder(projectFolder(ctx.tenantId, id)).catch((error: unknown) => {
    console.error("Failed to delete files of project", id, error);
  });
  return { projectId: id };
}
