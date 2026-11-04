import { and, asc, db, eq, isClientUser, isNotNull, projects, users } from "@repo/db";
import { markChanged } from "./changes";
import { requireAdmin, type Ctx } from "./context";
import { CHANGE_AREAS, type ClientOption, type ProjectClientError } from "./contract";
import { CoreError } from "./errors";

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

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function projectInTenant(tenantId: string, projectId: string) {
  return and(eq(projects.id, projectId), eq(projects.tenantId, tenantId));
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

/** Attaches an existing client to the project. Body: { clientId } */
export async function assignProjectClient(
  ctx: Ctx,
  projectId: string,
  input: Record<string, unknown>,
) {
  requireAdmin(ctx);

  const clientId = text(input.clientId);
  if (!clientId) fail("missing_fields");

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
      .where(eq(projects.id, projectId));
  });
  // A client removed and attached again between two polls still reloads.
  await markChanged(ctx.tenantId, projectId, CHANGE_AREAS);

  return { projectId };
}

/**
 * Detaches the project's client. Their account stays (see the Clients tab);
 * the app shows them their other projects, or none until they get another one.
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
