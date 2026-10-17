import { subcontractorsService } from "@repo/core";
import { fileResponse, withContext } from "../../../../../../../lib/api";

// GET /api/v1/subcontractors/:id/versions/:versionId → that version's PDF

type Params = { params: Promise<{ id: string; versionId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, versionId } = await params;
  return withContext(request, async (ctx) =>
    fileResponse(await subcontractorsService.openDocumentVersion(ctx, id, versionId), { immutable: true }),
  );
}
