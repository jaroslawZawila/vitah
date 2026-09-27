import { hitosService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../lib/api";

// GET → Hito · PATCH any of { name, pctBp, scope, billingMoment, chapterCodes }

type Params = { params: Promise<{ id: string; hitoId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, hitoId } = await params;
  return withContext(request, (ctx) => hitosService.getHito(ctx, id, hitoId));
}

export async function PATCH(request: Request, { params }: Params) {
  const { id, hitoId } = await params;
  return withContext(request, async (ctx) =>
    hitosService.updateHito(ctx, id, hitoId, await readJson(request)),
  );
}
