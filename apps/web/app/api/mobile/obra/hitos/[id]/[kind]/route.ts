import { CoreError, hitosService } from "@repo/core";
import { fileResponse, withMobileClient } from "../../../../../../../lib/api";

// GET /api/mobile/obra/hitos/:id/:kind — a hito's signed acta ("acta") or its
// invoice ("invoice"), as PDF, for the client of its project.

type Params = { params: Promise<{ id: string; kind: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, kind } = await params;
  return withMobileClient(request, async (client) => {
    if (kind !== "acta" && kind !== "invoice") throw new CoreError("not_found", 404);
    return fileResponse(await hitosService.openClientHitoFile(client.tenantId, client.sub, id, kind));
  });
}
