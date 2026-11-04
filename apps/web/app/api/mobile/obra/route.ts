import { obraService } from "@repo/core";
import { projectParam, withMobileClient } from "../../../../lib/api";

// ─── GET /api/mobile/obra ─────────────────────────────────────────────────────
// The app's Obra tab: stage, progress, the phases and the payment hitos of the
// signed-in client's project (`?projectId=`, else the default one);
// { obra: null } without a project. Requires `Authorization: Bearer <token>`.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  return withMobileClient(request, async (client) => ({
    obra: await obraService.getClientObra(client.tenantId, client.sub, projectParam(request)),
  }));
}
