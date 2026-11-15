import { and, asc, db, eq, isStaffUser, projects, tenants, users } from "@repo/db";
import { resolveClientProject } from "./client-projects";
import { requireAdmin, requireEditor, type Ctx } from "./context";
import type { MobileContact, OfficeContact, ProjectSiteManager, SiteManagerOption } from "./contract";
import { CoreError, notFound } from "./errors";
import { officeContactSchema, siteManagerSchema } from "./inputs/contact";
import { parse } from "./inputs/fields";
import { projectInTenant } from "./project-client";

// ─── Contact (the app's Contacto screen) ─────────────────────────────────────
// Who a client calls about their home: the project's site manager, one of the
// tenant's staff users picked on the project's General tab (admins and
// managers), and the builder's office, set by an admin. A site manager shows
// only while they are active staff of the tenant: deactivated, they are gone
// from the app at once (and deleted, the pointer empties). A client sees only
// the site manager of their own home, and only their name, phone and email.
//
// No change counter (./changes): Contacto is a screen pushed over the tabs and
// loads each time it opens, so nothing on screen goes stale.
// ─────────────────────────────────────────────────────────────────────────────

/** The tenant's active staff: who may be a site manager, and who is shown as one. */
const activeStaff = (tenantId: string) => and(eq(users.tenantId, tenantId), isStaffUser, eq(users.active, true));

const STAFF_CONTACT = { id: users.id, name: users.name, email: users.email, phone: users.phone };

const OFFICE = {
  address: tenants.officeAddress,
  phone: tenants.officePhone,
  email: tenants.officeEmail,
  hours: tenants.officeHours,
};

async function requireProject(tenantId: string, projectId: string) {
  const [project] = await db
    .select({ siteManagerUserId: projects.siteManagerUserId })
    .from(projects)
    .where(projectInTenant(tenantId, projectId));
  if (!project) throw new CoreError("project_not_found", 404);
  return project;
}

/** The project's site manager (null: none, or no longer active staff) and the staff who may be one. Admins and managers. */
export async function getProjectSiteManager(ctx: Ctx, projectId: string): Promise<ProjectSiteManager> {
  requireEditor(ctx);
  const project = await requireProject(ctx.tenantId, projectId);
  const options: SiteManagerOption[] = await db
    .select(STAFF_CONTACT)
    .from(users)
    .where(activeStaff(ctx.tenantId))
    .orderBy(asc(users.name), asc(users.email));
  return { siteManager: options.find((user) => user.id === project.siteManagerUserId) ?? null, options };
}

/** Body: { userId } — an active staff user of the tenant, or null to have none. Admins and managers. */
export async function setSiteManager(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  await requireProject(ctx.tenantId, projectId);
  const { userId } = parse(siteManagerSchema, input);
  if (userId) {
    const [user] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, userId), activeStaff(ctx.tenantId)));
    if (!user) throw new CoreError("user_not_found", 404);
  }
  await db
    .update(projects)
    .set({ siteManagerUserId: userId, updatedAt: new Date() })
    .where(projectInTenant(ctx.tenantId, projectId));
  return { projectId, userId };
}

/** The office the app shows the tenant's clients. Any staff role reads it. */
export async function getOfficeContact(ctx: Ctx): Promise<OfficeContact> {
  const [office] = await db.select(OFFICE).from(tenants).where(eq(tenants.id, ctx.tenantId));
  if (!office) throw notFound();
  return office;
}

/** Body: { address, phone, email, hours } — the whole office; a field not sent or blank is cleared. Admins only. */
export async function updateOfficeContact(ctx: Ctx, input: Record<string, unknown>): Promise<OfficeContact> {
  requireAdmin(ctx);
  const { address, phone, email, hours } = parse(officeContactSchema, input);
  const [office] = await db
    .update(tenants)
    .set({ officeAddress: address, officePhone: phone, officeEmail: email, officeHours: hours, updatedAt: new Date() })
    .where(eq(tenants.id, ctx.tenantId))
    .returning(OFFICE);
  if (!office) throw notFound();
  return office;
}

/**
 * The app's Contacto (GET /api/mobile/contact): the site manager of the
 * client's home `projectId` (else their default one; `project_not_found` if
 * it isn't theirs) and the office. Without a home: the office only. Called
 * with the client's own identity (from their mobile token).
 */
export async function getClientContact(
  tenantId: string,
  clientUserId: string,
  projectId?: string | null,
): Promise<MobileContact> {
  const project = await resolveClientProject(tenantId, clientUserId, projectId);
  const [managers, [tenant]] = await Promise.all([
    project
      ? db
          .select({ name: users.name, email: users.email, phone: users.phone })
          .from(projects)
          .innerJoin(users, and(eq(users.id, projects.siteManagerUserId), activeStaff(tenantId)))
          .where(projectInTenant(tenantId, project.id))
      : [],
    db.select({ name: tenants.name, ...OFFICE }).from(tenants).where(eq(tenants.id, tenantId)),
  ]);
  const manager = managers[0];
  const office = tenant && (tenant.address || tenant.phone || tenant.email || tenant.hours) ? tenant : null;
  return {
    siteManager: manager ? { name: manager.name || manager.email, phone: manager.phone, email: manager.email } : null,
    office,
  };
}
