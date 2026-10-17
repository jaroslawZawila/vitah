import { constructionService } from "@repo/core";
import { withContext } from "../../../../../../../lib/api";

// GET /api/v1/projects/:id/obra/control → ConstructionControl (the Obra tab's
// summary: chapters with their planned and actual dates, costs, sales, hitos,
// warnings, open issues, recent photos and records).

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => constructionService.getControl(ctx, id));
}
