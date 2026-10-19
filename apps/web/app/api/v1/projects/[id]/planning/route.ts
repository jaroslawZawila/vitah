import { planningService } from "@repo/core";
import { withContext } from "../../../../../../lib/api";

// GET /api/v1/projects/:id/planning → ProjectPlanning (the Obra tab's
// Planificación: the approved baseline with its forecast, and the open draft).

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => planningService.getPlanning(ctx, id));
}
