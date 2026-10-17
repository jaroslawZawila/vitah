import { subcontractorsService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../lib/api";

// POST /api/v1/subcontractors/:id/documents/:documentId/reject { reason } — rejects its current version.

type Params = { params: Promise<{ id: string; documentId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, documentId } = await params;
  return withContext(request, async (ctx) =>
    subcontractorsService.rejectDocument(ctx, id, documentId, await readJson(request)),
  );
}
