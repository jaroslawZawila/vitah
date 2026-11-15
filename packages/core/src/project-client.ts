import { and, asc, db, eq, isClientUser, isNotNull, isNull, projects, users, sql, type AnyColumn, type SQL } from "@repo/db";
import { lapseApprovals } from "./budget-approvals";
import { markChanged } from "./changes";
import { requireAdmin, type Ctx } from "./context";
import { CHANGE_AREAS, type ClientOption, type ProjectClientError } from "./contract";
import { CoreError } from "./errors";
import { projectClientSchema } from "./inputs/clients";
import { parse } from "./inputs/fields";

// ─── Project client access ────────────────────────────────────────────────────
// A "client" is the homeowner of a project. They sign in to the mobile app
// only, and a client may be attached to several projects (the app shows one
// at a time: ./client-projects.ts). Clients are created on the Clients tab
// (./clients.ts); here an admin picks one for a project or removes them from it.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS: Record<ProjectClientError, number> = {
  missing_fields: 400,
  project_not_found: 404,
  client_not_found: 404,
  client_already_attached: 409,
  no_client: 404,
  forbidden: 403,
};

function fail(code: ProjectClientError): never {
  throw new CoreError(code, STATUS[code]);
}

/**
 * A deleted project is only archived (`deleted_at`): its row and everything
 * under it stay, and no read or write may reach it. Every query on `projects`
 * carries this, here or through the helpers below and in ./client-projects.
 */
export const projectNotDeleted = () => isNull(projects.deletedAt);

/** The tenant's projects, the deleted ones left out. */
export function projectsInTenant(tenantId: string) {
  return and(eq(projects.tenantId, tenantId), projectNotDeleted());
}

/** Their ids, as a subquery for rows that only hold a `project_id`: `inArray(row.projectId, projectIdsInTenant(t))`. */
export function projectIdsInTenant(tenantId: string) {
  return db.select({ id: projects.id }).from(projects).where(projectsInTenant(tenantId));
}

/**
 * The same in raw SQL, for a row reached by its own id: `projectId` (the row's
 * column) names a project not deleted. It also goes inside raw statements and
 * `db.query` conditions, which rewrite every Drizzle column to the row's table:
 * hence the project named by hand.
 */
export const inLiveProject = (projectId: AnyColumn | SQL) =>
  sql`exists (select 1 from projects lp where lp.id = ${projectId} and lp.deleted_at is null)`;

/** And through an order: `orderId` names an order of a project not deleted. */
export const inLiveOrder = (orderId: AnyColumn | SQL) =>
  sql`exists (select 1 from purchase_orders lo join projects lp on lp.id = lo.project_id where lo.id = ${orderId} and lp.deleted_at is null)`;

/** What a soft delete sets on its row: when, and who. Nothing else of it changes, and no file goes. */
export const softDeleted = (ctx: Ctx) => ({ deletedAt: new Date(), deletedById: ctx.userId });

/** The project, if it is the tenant's and not deleted. */
export function projectInTenant(tenantId: string, projectId: string) {
  return and(eq(projects.id, projectId), projectsInTenant(tenantId));
}

export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Throws `client_not_found` unless `clientId` is an active client of the tenant. */
export async function requireAssignableClient(tx: Tx, tenantId: string, clientId: string) {
  const client = await tx.query.users.findFirst({
    where: and(
      eq(users.id, clientId),
      eq(users.tenantId, tenantId),
      isClientUser,
      eq(users.active, true),
    ),
    columns: { id: true },
  });
  if (!client) fail("client_not_found");
}

/** Every active client of the tenant: one may have several projects. */
export async function listAssignableClients(ctx: Ctx): Promise<ClientOption[]> {
  requireAdmin(ctx);

  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.tenantId, ctx.tenantId), isClientUser, eq(users.active, true)))
    .orderBy(asc(users.name), asc(users.email));
}

/**
 * Attaches an existing client to the project. Body: { clientId }. A request to
 * approve a budget revision still waiting (asked of a client since removed, or
 * one whose account was deleted) lapses: the new client is asked anew.
 */
export async function assignProjectClient(
  ctx: Ctx,
  projectId: string,
  input: Record<string, unknown>,
) {
  requireAdmin(ctx);

  const { clientId } = parse(projectClientSchema, input);

  await db.transaction(async (tx) => {
    const [project] = await tx
      .select({ clientUserId: projects.clientUserId })
      .from(projects)
      .where(projectInTenant(ctx.tenantId, projectId))
      .for("update");
    if (!project) fail("project_not_found");
    if (project.clientUserId) fail("client_already_attached");

    await requireAssignableClient(tx, ctx.tenantId, clientId);

    await tx
      .update(projects)
      .set({ clientUserId: clientId, updatedAt: new Date() })
      .where(projectInTenant(ctx.tenantId, projectId));
    await lapseApprovals(tx, projectId, ctx.userId);
  });
  // A client removed and attached again between two polls still reloads (the obra too: a request lapsed).
  await markChanged(ctx.tenantId, projectId, CHANGE_AREAS);

  return { projectId };
}

/**
 * Detaches the project's client. Their account stays (see the Clients tab);
 * the app shows them their other projects, or none until they get another one.
 * A request asked of them to approve a budget revision, still waiting, lapses.
 */
export async function unassignProjectClient(ctx: Ctx, projectId: string) {
  requireAdmin(ctx);

  const lapsed = await db.transaction(async (tx) => {
    // The project's row first, as every write on those requests takes it.
    const updated = await tx
      .update(projects)
      .set({ clientUserId: null, updatedAt: new Date() })
      .where(
        and(projectInTenant(ctx.tenantId, projectId), isNotNull(projects.clientUserId)),
      )
      .returning({ id: projects.id });
    if (updated.length === 0) fail("no_client");
    return lapseApprovals(tx, projectId, ctx.userId);
  });
  if (lapsed > 0) await markChanged(ctx.tenantId, projectId, ["obra"]);

  return { projectId };
}
