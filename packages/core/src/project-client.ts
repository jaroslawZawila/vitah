import { and, asc, db, eq, isClientUser, isNotNull, isNull, projects, users } from "@repo/db";
import { isUniqueViolation } from "./accounts";
import { requireAdmin, type Ctx } from "./context";
import type { ClientOption, MobileProject, ProjectClientError } from "./contract";
import { CoreError } from "./errors";

// ─── Project client access ────────────────────────────────────────────────────
// A "client" is the homeowner of a project. They sign in to the mobile app
// only, and each client is attached to at most one project. Clients are
// created on the Clients tab (./clients.ts); here an admin picks one for a
// project or removes them from it.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS: Record<ProjectClientError, number> = {
  missing_fields: 400,
  project_not_found: 404,
  client_not_found: 404,
  client_already_attached: 409,
  client_has_project: 409,
  no_client: 404,
  forbidden: 403,
};

function fail(code: ProjectClientError): never {
  throw new CoreError(code, STATUS[code]);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toCalendarDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function projectInTenant(tenantId: string, projectId: string) {
  return and(eq(projects.id, projectId), eq(projects.tenantId, tenantId));
}

/**
 * The project attached to a client, in the mobile app's shape. Called with the
 * client's own identity (from their mobile token), not a staff `Ctx`.
 */
export async function getClientProject(
  tenantId: string,
  clientUserId: string,
): Promise<MobileProject | null> {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.tenantId, tenantId), eq(projects.clientUserId, clientUserId)),
    columns: { id: true, ref: true, address: true, startDate: true, completionDate: true },
  });
  if (!project) return null;

  return {
    id: project.id,
    ref: project.ref,
    address: project.address,
    startDate: toCalendarDate(project.startDate),
    completionDate: toCalendarDate(project.completionDate),
  };
}

/** Active clients of the tenant that aren't attached to any project yet. */
export async function listAssignableClients(ctx: Ctx): Promise<ClientOption[]> {
  requireAdmin(ctx);

  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .leftJoin(projects, eq(projects.clientUserId, users.id))
    .where(
      and(
        eq(users.tenantId, ctx.tenantId),
        isClientUser,
        eq(users.active, true),
        isNull(projects.id),
      ),
    )
    .orderBy(asc(users.name), asc(users.email));
}

/** Attaches an existing client to the project. Body: { clientId } */
export async function assignProjectClient(
  ctx: Ctx,
  projectId: string,
  input: Record<string, unknown>,
) {
  requireAdmin(ctx);

  const clientId = text(input.clientId);
  if (!clientId) fail("missing_fields");

  try {
    await db.transaction(async (tx) => {
      const [project] = await tx
        .select({ clientUserId: projects.clientUserId })
        .from(projects)
        .where(projectInTenant(ctx.tenantId, projectId))
        .for("update");
      if (!project) fail("project_not_found");
      if (project.clientUserId) fail("client_already_attached");

      const client = await tx.query.users.findFirst({
        where: and(
          eq(users.id, clientId),
          eq(users.tenantId, ctx.tenantId),
          isClientUser,
          eq(users.active, true),
        ),
        columns: { id: true },
      });
      if (!client) fail("client_not_found");

      await tx
        .update(projects)
        .set({ clientUserId: clientId, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
    });
  } catch (error) {
    // projects.client_user_id is unique: the client is on another project.
    if (isUniqueViolation(error)) fail("client_has_project");
    throw error;
  }

  return { projectId };
}

/**
 * Detaches the project's client. Their account stays (see the Clients tab);
 * the app just shows them no project until they get another one.
 */
export async function unassignProjectClient(ctx: Ctx, projectId: string) {
  requireAdmin(ctx);

  const updated = await db
    .update(projects)
    .set({ clientUserId: null, updatedAt: new Date() })
    .where(
      and(projectInTenant(ctx.tenantId, projectId), isNotNull(projects.clientUserId)),
    )
    .returning({ id: projects.id });
  if (updated.length === 0) fail("no_client");

  return { projectId };
}
