import { constructionService } from "@repo/core";
import { withContext } from "../../../../../../../lib/api";

// GET /api/v1/projects/:id/obra/header → ControlHeader (ref, stage, open
// issues, the contract's chapters and today: what forms and headers need).

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => constructionService.getControlHeader(ctx, id));
}
