import { documentsService } from "@repo/core";
import { withMobileClient } from "../../../../lib/api";

// ─── GET /api/mobile/documents ────────────────────────────────────────────────
// Documents of the signed-in client's project: { documents: MobileDocument[] }.
// Empty when no project is attached. Requires `Authorization: Bearer <token>`.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  return withMobileClient(request, async (client) => ({
    documents: await documentsService.listClientDocuments(client.tenantId, client.sub),
  }));
}
