import { and, asc, db, eq, inArray, planningItems, planningVersions } from "@repo/db";

// The approved Planning baseline as the rest of the platform reads it (./planning
// writes it): the Obra tab, Compras and the client's app. Depends on nothing
// else in core, so any module can import it.

export type PlanVersionRow = typeof planningVersions.$inferSelect;
export type PlanItemRow = typeof planningItems.$inferSelect;

/** An approved baseline: its version (start day, calendar) and its items in order (rules and stored dates). */
export type ApprovedPlan = { version: PlanVersionRow; items: PlanItemRow[] };

export type PlanDates = Map<string, { start: string; end: string; leadDays: number }>;

/** The approved Planning baseline's dates and lead times by chapter code (./planning); null without one. */
export async function approvedPlanDates(tenantId: string, projectId: string): Promise<PlanDates | null> {
  return planDatesOf((await approvedPlansOf(tenantId, [projectId])).get(projectId) ?? null);
}

/** A baseline's dates and lead times by chapter code; null without one, or with no items. */
export function planDatesOf(plan: ApprovedPlan | null): PlanDates | null {
  if (!plan || plan.items.length === 0) return null;
  return new Map(plan.items.map((i) => [i.chapterCode, { start: i.plannedStart, end: i.plannedEnd, leadDays: i.leadDays }]));
}

/**
 * Each project's approved baseline, in one query: what the Obra tab's dates
 * (`planDatesOf`) and the schedule's forecast (./planning) both read. A
 * project without one is absent.
 */
export async function approvedPlansOf(tenantId: string, projectIds: string[]): Promise<Map<string, ApprovedPlan>> {
  const plans = new Map<string, ApprovedPlan>();
  if (projectIds.length === 0) return plans;
  const rows = await db
    .select({ version: planningVersions, item: planningItems })
    .from(planningVersions)
    .leftJoin(planningItems, eq(planningItems.versionId, planningVersions.id))
    .where(
      and(
        inArray(planningVersions.projectId, projectIds),
        eq(planningVersions.tenantId, tenantId),
        eq(planningVersions.status, "approved"),
      ),
    )
    .orderBy(asc(planningItems.position));
  for (const { version, item } of rows) {
    const plan = plans.get(version.projectId) ?? { version, items: [] };
    // There is one approved version at most; were there two, one is kept whole.
    if (plan.version.id !== version.id) continue;
    if (item) plan.items.push(item);
    plans.set(version.projectId, plan);
  }
  return plans;
}
