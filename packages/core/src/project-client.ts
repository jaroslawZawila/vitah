import bcrypt from "bcryptjs";
import { and, db, eq, inArray, isClientUser, projects, users } from "@repo/db";
import { MIN_PASSWORD_LENGTH, type MobileProject, type ProjectClientError } from "./contract";

// ─── Project client access ────────────────────────────────────────────────────
// A "client" is the homeowner of a project. They sign in to the mobile app
// only, and each client is attached to at most one project.
// ─────────────────────────────────────────────────────────────────────────────

export type Result = { ok: true } | { ok: false; error: ProjectClientError };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Tests lower the cost (see @repo/db/vitest); production always uses 12.
const BCRYPT_COST = Number(process.env.BCRYPT_COST ?? 12);

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, BCRYPT_COST);
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

export async function getClientProject(
  tenantId: string,
  clientUserId: string,
): Promise<MobileProject | null> {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.tenantId, tenantId), eq(projects.clientUserId, clientUserId)),
    columns: { id: true, ref: true, location: true, startDate: true, expectedDeliveryDate: true },
  });
  if (!project) return null;

  return {
    id: project.id,
    ref: project.ref,
    address: project.location,
    startDate: toCalendarDate(project.startDate),
    completionDate: toCalendarDate(project.expectedDeliveryDate),
  };
}

/** Creates a client user and attaches them to the project, atomically. */
export async function createProjectClient(
  tenantId: string,
  projectId: string,
  input: { name: string; email: string; password: string },
): Promise<Result> {
  const name = input.name.trim();
  const email = normalizeEmail(input.email);
  const { password } = input;

  if (!name || !email || !password) return { ok: false, error: "missing_fields" };
  if (!EMAIL_PATTERN.test(email)) return { ok: false, error: "invalid_email" };
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, error: "password_too_short" };

  // Cheap checks before the slow hash; the locked re-check below is authoritative.
  const existing = await findProjectClientId(tenantId, projectId);
  if (existing === undefined) return { ok: false, error: "project_not_found" };
  if (existing) return { ok: false, error: "client_already_attached" };

  const passwordHash = await hashPassword(password);

  try {
    return await db.transaction(async (tx): Promise<Result> => {
      const [project] = await tx
        .select({ clientUserId: projects.clientUserId })
        .from(projects)
        .where(projectInTenant(tenantId, projectId))
        .for("update");

      if (!project) return { ok: false, error: "project_not_found" };
      if (project.clientUserId) return { ok: false, error: "client_already_attached" };

      const [client] = await tx
        .insert(users)
        .values({ tenantId, name, email, passwordHash, role: "client" })
        .returning({ id: users.id });

      await tx
        .update(projects)
        .set({ clientUserId: client!.id, updatedAt: new Date() })
        .where(eq(projects.id, projectId));

      return { ok: true };
    });
  } catch (error) {
    // Email taken by a client in any tenant, or by anyone in this tenant.
    if (isUniqueViolation(error)) return { ok: false, error: "email_exists" };
    throw error;
  }
}

export async function resetProjectClientPassword(
  tenantId: string,
  projectId: string,
  password: string,
): Promise<Result> {
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, error: "password_too_short" };

  const clientUserId = await findProjectClientId(tenantId, projectId);
  if (!clientUserId) return { ok: false, error: "no_client" };

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(password), updatedAt: new Date() })
    .where(and(eq(users.id, clientUserId), eq(users.tenantId, tenantId)));

  return { ok: true };
}

/**
 * Deletes the project's client account. Their app session stops working on
 * the next request, and the project can get a new client afterwards.
 */
export async function revokeProjectClient(tenantId: string, projectId: string): Promise<Result> {
  const deleted = await db
    .delete(users)
    .where(
      and(
        inArray(
          users.id,
          db
            .select({ id: projects.clientUserId })
            .from(projects)
            .where(projectInTenant(tenantId, projectId)),
        ),
        eq(users.tenantId, tenantId),
        isClientUser,
      ),
    )
    .returning({ id: users.id });

  return deleted.length ? { ok: true } : { ok: false, error: "no_client" };
}
