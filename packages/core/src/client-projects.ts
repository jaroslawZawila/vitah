import { and, asc, db, desc, eq, projects, sql } from "@repo/db";
import { toCalendarDate } from "./calendar";
import { EXECUTION_STAGE, HANDED_OVER_STAGE, type MobileProject, type ObraStage } from "./contract";
import { CoreError } from "./errors";
import { loadObra } from "./obra-data";
import { clientDates } from "./planning-calc";
import { approvedPlanDates } from "./planning-data";

// ─── A client's projects (mobile app) ────────────────────────────────────────
// A client may be the homeowner of several projects. The app shows one at a
// time: the one it asks for (`?projectId=`), else the default, the newest one
// not handed over yet (the newest of all when every one is). Called with the
// client's own identity (from their mobile token), not a staff `Ctx`.
// ─────────────────────────────────────────────────────────────────────────────

/** Every project attached to a mobile-app client. */
export function clientProjectsWhere(tenantId: string, clientUserId: string) {
  return and(eq(projects.tenantId, tenantId), eq(projects.clientUserId, clientUserId));
}

/** Open ones first, then handed over; the newest (by start, else creation) first in each. */
export const DEFAULT_FIRST = [
  asc(sql`${projects.obraStage} >= ${HANDED_OVER_STAGE}`),
  desc(sql`coalesce(${projects.startDate}, ${projects.createdAt})`),
  desc(projects.createdAt),
  asc(projects.id),
];

const COLUMNS = {
  id: true,
  ref: true,
  address: true,
  obraStage: true,
  startDate: true,
  completionDate: true,
} as const;

const query = (tenantId: string, clientUserId: string, projectId?: string | null) => ({
  where: projectId
    ? and(clientProjectsWhere(tenantId, clientUserId), eq(projects.id, projectId))
    : clientProjectsWhere(tenantId, clientUserId),
  columns: COLUMNS,
  orderBy: DEFAULT_FIRST,
});

type ClientProjectRow = NonNullable<Awaited<ReturnType<typeof resolveClientProject>>>;

/**
 * The project a client's request is about: `projectId` if given (it must be
 * one of theirs, else `project_not_found`), else their default one; null when
 * they have none.
 */
export async function resolveClientProject(
  tenantId: string,
  clientUserId: string,
  projectId?: string | null,
) {
  const project = await db.query.projects.findFirst(query(tenantId, clientUserId, projectId));
  if (!project && projectId) throw new CoreError("project_not_found", 404);
  return project ?? null;
}

/**
 * A project in the app's shape. Its dates are the ones the client is told:
 * the approved plan's start and end (the handover), else the dates staff set.
 * `progressPct` only while the works are under way (stages 6–7).
 */
async function toMobileProject(tenantId: string, project: ClientProjectRow): Promise<MobileProject> {
  const stage = project.obraStage as ObraStage;
  // Under way: the obra also gives the plan's dates.
  const obra = stage >= EXECUTION_STAGE && stage < HANDED_OVER_STAGE ? await loadObra(tenantId, project.id) : null;
  const planDates = obra ? obra.planDates : await approvedPlanDates(tenantId, project.id);
  return {
    id: project.id,
    ref: project.ref,
    address: project.address,
    ...clientDates(planDates, {
      startDate: toCalendarDate(project.startDate),
      completionDate: toCalendarDate(project.completionDate),
    }),
    handedOver: stage >= HANDED_OVER_STAGE,
    progressPct: obra ? obra.progress.progressPct : null,
  };
}

/** The client's project (`projectId`, else the default one); null without one. */
export async function getClientProject(
  tenantId: string,
  clientUserId: string,
  projectId?: string | null,
): Promise<MobileProject | null> {
  const project = await resolveClientProject(tenantId, clientUserId, projectId);
  return project && toMobileProject(tenantId, project);
}

/** Every project of the client, the default one first: open ones, then handed over, newest first. */
export async function listClientProjects(tenantId: string, clientUserId: string): Promise<MobileProject[]> {
  const rows = await db.query.projects.findMany(query(tenantId, clientUserId));
  return Promise.all(rows.map((row) => toMobileProject(tenantId, row)));
}
