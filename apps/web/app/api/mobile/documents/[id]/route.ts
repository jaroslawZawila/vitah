import { documentsService } from "@repo/core";
import { fileResponse, withMobileClient } from "../../../../../lib/api";

// ─── GET /api/mobile/documents/:id ────────────────────────────────────────────
// The PDF, if it belongs to the signed-in client's project; 404 otherwise.
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withMobileClient(request, async (client) =>
    fileResponse(await documentsService.openClientDocument(client.tenantId, client.sub, id)),
  );
}
