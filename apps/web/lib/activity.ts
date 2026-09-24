import { db, projectActivityLog } from "@repo/db";

/** Records an entry in a project's activity log. */
export async function logActivity(
  tenantId: string,
  projectId: string,
  userId: string,
  action: string,
  detail: string,
) {
  await db.insert(projectActivityLog).values({
    tenantId,
    projectId,
    userId,
    action,
    detail,
  });
}
