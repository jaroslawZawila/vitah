import { db, projectActivityLog } from "@repo/db";
import type { Ctx } from "./context";

/** Records an entry in a project's activity log, attributed to the caller. */
export async function logActivity(
  ctx: Ctx,
  projectId: string,
  action: string,
  detail: string,
) {
  await db.insert(projectActivityLog).values({
    tenantId: ctx.tenantId,
    projectId,
    userId: ctx.userId,
    action,
    detail,
  });
}
