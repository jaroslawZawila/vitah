import { and, db, eq, planningVersions } from "@repo/db";
import type { Ctx } from "../context";
import * as planning from "../planning";

// `pnpm db:seed`: VTH-26-001's first plan, the standard one on Cantabria's
// calendar from the project's start, approved as its baseline. What Avance
// recorded (./seed-obra's seedControl) keeps its real dates.

/** Approves a first plan for the project; false when it already has one. */
export async function seedPlanning(ctx: Ctx, projectId: string): Promise<boolean> {
  const existing = await db.query.planningVersions.findFirst({
    where: and(eq(planningVersions.projectId, projectId), eq(planningVersions.tenantId, ctx.tenantId)),
    columns: { id: true },
  });
  if (existing) return false;
  await planning.createPlanningDraft(ctx, projectId, { from: "template", region: "cb", augustClosure: true, christmasClosure: true });
  await planning.approvePlanningDraft(ctx, projectId, { reason: "Plan inicial con el acta de inicio" });
  return true;
}
