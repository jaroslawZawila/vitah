import { obraService } from "@repo/core";
import { readJson, withContext } from "../../../../../../lib/api";

// ─── /api/v1/projects/:id/obra ────────────────────────────────────────────────
// GET → ProjectObra (stage, progress, payments, chapters, hitos)
// PUT { stage: 1–8 } → { stage }
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => obraService.getObra(ctx, id));
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) => obraService.setStage(ctx, id, await readJson(request)));
}
