import { subcontractorsService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../lib/api";

// POST /api/v1/subcontractors/:id/documents/request { requirementIds, workerId?, projectId? }
// Asks the company for documents, or reminds it of ones already asked for.

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) => subcontractorsService.requestDocuments(ctx, id, await readJson(request)));
}
