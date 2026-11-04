import { clientProjectsService } from "@repo/core";
import { projectParam, withMobileClient } from "../../../../lib/api";

// ─── GET /api/mobile/project ──────────────────────────────────────────────────
// One of the signed-in client's projects: `?projectId=`, else the default one
// (the newest not yet handed over), or { project: null } when none is
// attached. 404 `project_not_found` for a project that isn't theirs.
// Requires `Authorization: Bearer <token>`.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  return withMobileClient(request, async (client) => ({
    project: await clientProjectsService.getClientProject(client.tenantId, client.sub, projectParam(request)),
  }));
}
