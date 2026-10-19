import { and, db, eq, planningItems, planningVersions } from "@repo/db";

// The approved Planning baseline as the rest of the platform reads it (./planning
// writes it): the Obra tab, Compras and the client's app. Depends on nothing
// else in core, so any module can import it.

/** The approved Planning baseline's dates and lead times by chapter code (./planning); null without one. */
export async function approvedPlanDates(
  tenantId: string,
  projectId: string,
): Promise<Map<string, { start: string; end: string; leadDays: number }> | null> {
  const rows = await db
    .select({
      code: planningItems.chapterCode,
      start: planningItems.plannedStart,
      end: planningItems.plannedEnd,
      leadDays: planningItems.leadDays,
    })
    .from(planningItems)
    .innerJoin(planningVersions, eq(planningVersions.id, planningItems.versionId))
    .where(
      and(
        eq(planningVersions.projectId, projectId),
        eq(planningVersions.tenantId, tenantId),
        eq(planningVersions.status, "approved"),
      ),
    );
  return rows.length > 0 ? new Map(rows.map(({ code, ...dates }) => [code, dates])) : null;
}
