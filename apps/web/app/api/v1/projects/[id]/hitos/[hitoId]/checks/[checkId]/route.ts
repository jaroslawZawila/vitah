import { hitosService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../../lib/api";

// PATCH { label?, done? } · DELETE

type Params = { params: Promise<{ id: string; hitoId: string; checkId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id, hitoId, checkId } = await params;
  return withContext(request, async (ctx) =>
    hitosService.updateCheck(ctx, id, checkId, await readJson(request), hitoId),
  );
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, hitoId, checkId } = await params;
  return withContext(request, (ctx) => hitosService.deleteCheck(ctx, id, checkId, hitoId));
}
