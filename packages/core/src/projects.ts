import { db, projects, eq, and, desc } from "@repo/db";
import { requireAdmin, type Ctx } from "./context";
import { invalid, notFound } from "./errors";
import { clientConflict, requireAssignableClient } from "./project-client";

// Every function here takes `ctx` and filters by `ctx.tenantId`.
// A project holds exactly what the client's mobile app shows.

// Input parsing: API bodies and form values arrive as unknown / strings.

function str(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** `undefined` = not provided, `null` = cleared (empty string or null). */
function date(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || (typeof value === "string" && value.trim() === "")) return null;
  if (typeof value !== "string") throw invalid("invalid_date");
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) throw invalid("invalid_date");
  return d;
}

const clientColumns = { columns: { id: true, name: true, email: true } } as const;

export async function listProjects(ctx: Ctx) {
  return db.query.projects.findMany({
    where: eq(projects.tenantId, ctx.tenantId),
    with: { client: clientColumns },
    orderBy: [desc(projects.createdAt)],
  });
}

export async function getProject(ctx: Ctx, id: string) {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, id), eq(projects.tenantId, ctx.tenantId)),
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
  const ref = str(input.ref);
  const address = str(input.address);
  if (!ref || !address) throw invalid("missing_fields");
  const startDate = date(input.startDate) ?? null;
  const completionDate = date(input.completionDate) ?? null;
  const clientId = str(input.clientId) ?? null;
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
  const set: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };

  if (input.address !== undefined) {
    const address = str(input.address);
    if (!address) throw invalid("missing_fields");
    set.address = address;
  }
  const startDate = date(input.startDate);
  if (startDate !== undefined) set.startDate = startDate;
  const completionDate = date(input.completionDate);
  if (completionDate !== undefined) set.completionDate = completionDate;

  const updated = await db
    .update(projects)
    .set(set)
    .where(and(eq(projects.id, id), eq(projects.tenantId, ctx.tenantId)))
    .returning({ id: projects.id });
  if (updated.length === 0) throw notFound();

  return { projectId: id };
}

export async function deleteProject(ctx: Ctx, id: string) {
  const deleted = await db
    .delete(projects)
    .where(and(eq(projects.id, id), eq(projects.tenantId, ctx.tenantId)))
    .returning({ id: projects.id });
  if (deleted.length === 0) throw notFound();
  return { projectId: id };
}
