import { withContext } from "../../../../../../../../../lib/api";
import { cancelBudgetGeneration } from "../../../../../../../../../lib/budget-generation";

// POST → stops a queued or running generation.

type Params = { params: Promise<{ id: string; generationId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, generationId } = await params;
  return withContext(request, (ctx) => cancelBudgetGeneration(ctx, id, generationId));
}
