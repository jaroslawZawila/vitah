import { projectClientService } from "@repo/core";
import { withMobileClient } from "../../../../lib/api";

// ─── GET /api/mobile/project ──────────────────────────────────────────────────
// The project attached to the signed-in client, or { project: null } when no
// project is attached yet. Requires `Authorization: Bearer <token>`.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  return withMobileClient(request, async (client) => ({
    project: await projectClientService.getClientProject(client.tenantId, client.sub),
  }));
}
