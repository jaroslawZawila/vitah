import { budgetApprovalsService } from "@repo/core";
import { projectParam, withMobileClient } from "../../../../lib/api";

// ─── GET /api/mobile/approvals ────────────────────────────────────────────────
// The change to the contract waiting for the signed-in client's answer on
// their home (`?projectId=`, else the default one): { approval } or
// { approval: null }. Requires `Authorization: Bearer <token>`.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  return withMobileClient(request, async (client) => ({
    approval: await budgetApprovalsService.getClientApproval(client.tenantId, client.sub, projectParam(request)),
  }));
}
