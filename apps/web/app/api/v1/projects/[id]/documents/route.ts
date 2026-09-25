import { documentsService } from "@repo/core";
import { readForm, withContext } from "../../../../../../lib/api";

// ─── /api/v1/projects/:id/documents ───────────────────────────────────────────
// GET  → ProjectDocument[]
// POST → multipart form { title, category, file (PDF, ≤ 4 MB) } → { documentId }
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => documentsService.listDocuments(ctx, id));
}

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(
    request,
    async (ctx) => documentsService.addDocument(ctx, id, await readForm(request)),
    201,
  );
}
