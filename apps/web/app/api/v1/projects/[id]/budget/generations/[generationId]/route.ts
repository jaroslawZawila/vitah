import { budgetGenerationsService } from "@repo/core";
import { withContext } from "../../../../../../../../lib/api";

// GET → the run's status, progress log and what the AI read so far.

type Params = { params: Promise<{ id: string; generationId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, generationId } = await params;
  return withContext(request, (ctx) => budgetGenerationsService.getGeneration(ctx, id, generationId));
}
