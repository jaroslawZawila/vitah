import { hitosService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../lib/api";

// POST { label } → { checkId }

type Params = { params: Promise<{ id: string; hitoId: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id, hitoId } = await params;
  return withContext(
    request,
    async (ctx) => hitosService.addCheck(ctx, id, hitoId, await readJson(request)),
    201,
  );
}
