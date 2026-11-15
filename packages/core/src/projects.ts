import { and, db, desc, eq, projects } from "@repo/db";
import { markChanged } from "./changes";
import { requireAdmin, requireEditor, type Ctx } from "./context";
import { invalid, notFound } from "./errors";
import { parse } from "./inputs/fields";
import { projectChangesSchema, projectDatesSchema, projectNamesSchema, projectSchema } from "./inputs/projects";
import { projectInTenant, projectsInTenant, requireAssignableClient, softDeleted } from "./project-client";

// Every function here takes `ctx` and filters by `ctx.tenantId`.
// A project holds exactly what the client's mobile app shows.

function checkOrder(start: Date | null | undefined, completion: Date | null | undefined) {
  if (start && completion && completion < start) throw invalid("dates_out_of_order");
}

const clientColumns = { columns: { id: true, name: true, email: true } } as const;

// The change counters are the app's business (./changes), and the reviewed
// revision the Obra tab's (./construction): not part of the project. Nor is
// the deletion mark: a project that can be read has none.
const projectColumns = {
  deletedAt: false,
  deletedById: false,
  obraReviewedRevisionId: false,
  projectRev: false,
  obraRev: false,
  photosRev: false,
  documentsRev: false,
} as const;

export async function listProjects(ctx: Ctx) {
  return db.query.projects.findMany({
    where: projectsInTenant(ctx.tenantId),
    columns: projectColumns,
    with: { client: clientColumns },
    orderBy: [desc(projects.createdAt)],
  });
}

export async function getProject(ctx: Ctx, id: string) {
  const project = await db.query.projects.findFirst({
    where: projectInTenant(ctx.tenantId, id),
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
  // In the old order: ref and address (what is missing), the dates (their order), then the client.
  const { ref, address } = parse(projectNamesSchema, input);
  if (!ref || !address) throw invalid("missing_fields");
  const dates = parse(projectDatesSchema, input);
  const startDate = dates.startDate ?? null;
  const completionDate = dates.completionDate ?? null;
  checkOrder(startDate, completionDate);
  const clientId = parse(projectSchema, input).clientId ?? null;
  if (clientId) requireAdmin(ctx);

  // Among the projects not deleted: a deleted one's ref is free again.
  const existing = await db.query.projects.findFirst({
    where: and(projectsInTenant(ctx.tenantId), eq(projects.ref, ref)),
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
  const { address, startDate, completionDate } = parse(projectChangesSchema, input);
  const set: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
  if (address !== undefined) set.address = address;
  if (startDate !== undefined) set.startDate = startDate;
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
 * Deletes the project for its users: admin only. It is archived, not erased
 * (`deleted_at`, and who did it): its row, everything under it and its stored
 * files stay as they are, and from then on nothing lists or reaches it, in the
 * portal, the API or the client's app. Its ref is free for a new project.
 * `not_found` if it isn't the tenant's, or is deleted already.
 */
export async function deleteProject(ctx: Ctx, id: string) {
  requireAdmin(ctx);
  const [deleted] = await db
    .update(projects)
    .set(softDeleted(ctx))
    .where(projectInTenant(ctx.tenantId, id))
    .returning({ id: projects.id });
  if (!deleted) throw notFound();
  return { projectId: id };
}
