import { subcontractorsService } from "@repo/core";
import { withContext } from "../../../../../../../../lib/api";

// POST /api/v1/subcontractors/:id/documents/:documentId/validate — validates its current version.

type Params = { params: Promise<{ id: string; documentId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, documentId } = await params;
  return withContext(request, (ctx) => subcontractorsService.validateDocument(ctx, id, documentId));
}
