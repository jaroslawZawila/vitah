import { hitosService } from "@repo/core";
import { readJson, withContext } from "../../../../../../lib/api";

// ─── /api/v1/projects/:id/hitos ───────────────────────────────────────────────
// GET → Hito[] (the payment plan H0–H9)
// PUT { hitos: [{ id, name?, pctBp?, scope?, billingMoment?, chapterCodes? }] }
//     → { updated }: several hitos at once, all or nothing
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => hitosService.listHitos(ctx, id));
}

export async function PUT(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, async (ctx) =>
    hitosService.updatePlan(ctx, id, await readJson(request)),
  );
}
