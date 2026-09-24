import { and, db, eq, inArray, isClientUser, projects, users } from "@repo/db";
import { hashPassword, normalizeEmail } from "./accounts";
import { requireAdmin, type Ctx } from "./context";
import { MIN_PASSWORD_LENGTH, type MobileProject, type ProjectClientError } from "./contract";
import { CoreError } from "./errors";

// ─── Project client access ────────────────────────────────────────────────────
// A "client" is the homeowner of a project. They sign in to the mobile app
// only, and each client is attached to at most one project. Managing clients
// is admin only.
// ─────────────────────────────────────────────────────────────────────────────

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const STATUS: Record<ProjectClientError, number> = {
  missing_fields: 400,
  invalid_email: 400,
  password_too_short: 400,
  email_exists: 409,
  client_already_attached: 409,
  project_not_found: 404,
  no_client: 404,
};

function fail(code: ProjectClientError): never {
  throw new CoreError(code, STATUS[code]);
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toCalendarDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null;
}

function isUniqueViolation(error: unknown): boolean {
  // Drizzle wraps driver errors, keeping the original as `cause`.
  const candidates = [error, (error as { cause?: unknown } | null)?.cause];
  return candidates.some(
    (e) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "23505",
  );
}

function projectInTenant(tenantId: string, projectId: string) {
  return and(eq(projects.id, projectId), eq(projects.tenantId, tenantId));
}

/** `undefined` when the project doesn't exist in the tenant. */
async function findProjectClientId(tenantId: string, projectId: string) {
  const project = await db.query.projects.findFirst({
    where: projectInTenant(tenantId, projectId),
    columns: { clientUserId: true },
  });
  return project && project.clientUserId;
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

/**
 * Creates a client user and attaches them to the project, atomically.
 * Body: { name, email, password }
 */
export async function createProjectClient(
  ctx: Ctx,
  projectId: string,
  input: Record<string, unknown>,
) {
  requireAdmin(ctx);

  const name = text(input.name).trim();
  const email = normalizeEmail(text(input.email));
  const password = text(input.password);

  if (!name || !email || !password) fail("missing_fields");
  if (!EMAIL_PATTERN.test(email)) fail("invalid_email");
  if (password.length < MIN_PASSWORD_LENGTH) fail("password_too_short");

  // Cheap checks before the slow hash; the locked re-check below is authoritative.
  const existing = await findProjectClientId(ctx.tenantId, projectId);
  if (existing === undefined) fail("project_not_found");
  if (existing) fail("client_already_attached");

  const passwordHash = await hashPassword(password);

  try {
    await db.transaction(async (tx) => {
      const [project] = await tx
        .select({ clientUserId: projects.clientUserId })
        .from(projects)
        .where(projectInTenant(ctx.tenantId, projectId))
        .for("update");

      if (!project) fail("project_not_found");
      if (project.clientUserId) fail("client_already_attached");

      const [client] = await tx
        .insert(users)
        .values({ tenantId: ctx.tenantId, name, email, passwordHash, role: "client" })
        .returning({ id: users.id });

      await tx
        .update(projects)
        .set({ clientUserId: client!.id, updatedAt: new Date() })
        .where(eq(projects.id, projectId));
    });
  } catch (error) {
    // Email taken by a client in any tenant, or by anyone in this tenant.
    if (isUniqueViolation(error)) fail("email_exists");
    throw error;
  }

  return { projectId };
}

/** Body: { password } */
export async function resetProjectClientPassword(
  ctx: Ctx,
  projectId: string,
  input: Record<string, unknown>,
) {
  requireAdmin(ctx);

  const password = text(input.password);
  if (password.length < MIN_PASSWORD_LENGTH) fail("password_too_short");

  const clientUserId = await findProjectClientId(ctx.tenantId, projectId);
  if (!clientUserId) fail("no_client");

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(and(eq(users.id, clientUserId), eq(users.tenantId, ctx.tenantId)));

  return { projectId };
}

/**
 * Deletes the project's client account. Their app session stops working on
 * the next request, and the project can get a new client afterwards.
 */
export async function revokeProjectClient(ctx: Ctx, projectId: string) {
  requireAdmin(ctx);

  const deleted = await db
    .delete(users)
    .where(
      and(
        inArray(
          users.id,
          db
            .select({ id: projects.clientUserId })
            .from(projects)
            .where(projectInTenant(ctx.tenantId, projectId)),
        ),
        eq(users.tenantId, ctx.tenantId),
        isClientUser,
      ),
    )
    .returning({ id: users.id });
  if (deleted.length === 0) fail("no_client");

  return { projectId };
}
