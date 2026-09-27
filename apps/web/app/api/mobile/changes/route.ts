import { changesService } from "@repo/core";
import { withMobileClient } from "../../../../lib/api";

// ─── GET /api/mobile/changes ──────────────────────────────────────────────────
// A counter per part of the app (project, obra, photos, documents) for the
// signed-in client's project, or { changes: null } without one. The open app
// polls it and reloads a part when its counter moves. Requires
// `Authorization: Bearer <token>`.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  return withMobileClient(request, async (client) => ({
    changes: await changesService.getClientChanges(client.tenantId, client.sub),
  }));
}
