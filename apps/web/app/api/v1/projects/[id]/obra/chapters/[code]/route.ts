import { obraService } from "@repo/core";
import { withContext } from "../../../../../../../../lib/api";

// GET /api/v1/projects/:id/obra/chapters/:code → { chapter, hito, photos }
// (a chapter of the accepted budget).

type Params = { params: Promise<{ id: string; code: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, code } = await params;
  return withContext(request, (ctx) => obraService.getChapter(ctx, id, code));
}
