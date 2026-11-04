import { changesService } from "@repo/core";
import { projectParam, withMobileClient } from "../../../../lib/api";

// ─── GET /api/mobile/changes ──────────────────────────────────────────────────
// A counter per part of the app (project, obra, photos, documents) for the
// signed-in client's project (`?projectId=`, else the default one), or
// { changes: null } without one (or once that project is no longer theirs),
// plus `projects`, a key that moves when their list of projects changes. The
// open app polls it and reloads a part when its counter moves. Requires
// `Authorization: Bearer <token>`.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  return withMobileClient(request, (client) =>
    changesService.getClientChanges(client.tenantId, client.sub, projectParam(request)),
  );
}
