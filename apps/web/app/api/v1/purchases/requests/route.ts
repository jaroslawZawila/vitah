import { purchaseRequestsService } from "@repo/core";
import { withContext } from "../../../../../lib/api";

// ─── /api/v1/purchases/requests ───────────────────────────────────────────────
// GET (?projectId) → TenantRequests: the purchase requests, those to decide
//   first. One is made on its project: POST /api/v1/projects/:id/purchases/requests
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const projectId = new URL(request.url).searchParams.get("projectId") ?? undefined;
  return withContext(request, (ctx) => purchaseRequestsService.listRequests(ctx, { projectId }));
}
