import { subcontractorsService } from "@repo/core";
import { readForm, withContext } from "../../../../../../lib/api";

// POST /api/v1/subcontractors/:id/documents — multipart { requirementId, workerId?,
// projectId?, issuedAt?, expiresAt?, file (PDF, ≤ 4 MB) } → { versionId, version }.
// A new version of the document; older ones are kept.

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(
    request,
    async (ctx) => subcontractorsService.uploadDocument(ctx, id, await readForm(request)),
    201,
  );
}
