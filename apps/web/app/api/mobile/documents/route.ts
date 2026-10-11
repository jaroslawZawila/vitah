import { documentsService } from "@repo/core";
import { withMobileClient } from "../../../../lib/api";

// ─── GET /api/mobile/documents ────────────────────────────────────────────────
// Documents of the signed-in client's project: { documents: MobileDocument[] }.
// Empty when no project is attached. Requires `Authorization: Bearer <token>`.
// `?categories=contract,plans,…` lists the categories the app knows; builds
// that don't send it get newer categories as "other".
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request: Request) {
  const categories = new URL(request.url).searchParams.get("categories")?.split(",");
  return withMobileClient(request, async (client) => ({
    documents: await documentsService.listClientDocuments(client.tenantId, client.sub, categories),
  }));
}
