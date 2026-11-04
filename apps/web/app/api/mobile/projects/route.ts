import { clientProjectsService } from "@repo/core";
import { withMobileClient } from "../../../../lib/api";

// ─── GET /api/mobile/projects ─────────────────────────────────────────────────
// Every project of the signed-in client: { projects: MobileProject[] }, the
// default one first (the newest not yet handed over), then the other open
// ones, then the handed-over ones. Empty without a project. Requires
// `Authorization: Bearer <token>`.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  return withMobileClient(request, async (client) => ({
    projects: await clientProjectsService.listClientProjects(client.tenantId, client.sub),
  }));
}
