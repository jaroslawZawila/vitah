import { CoreError, hitosService, type HitoFileKind } from "@repo/core";
import { fileResponse, readForm, withContext } from "../../../../../../../../../lib/api";

// ─── /api/v1/projects/:id/hitos/:hitoId/files/:kind (acta | invoice) ──────────
// GET → the PDF · PUT multipart { file, date } (acta: signed on; invoice:
// dated, default today) · DELETE
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string; hitoId: string; kind: string }> };

async function parse(params: Params["params"]) {
  const { id, hitoId, kind } = await params;
  if (kind !== "acta" && kind !== "invoice") throw new CoreError("not_found", 404);
  return { id, hitoId, kind: kind as HitoFileKind };
}

export async function GET(request: Request, { params }: Params) {
  return withContext(request, async (ctx) => {
    const { id, hitoId, kind } = await parse(params);
    return fileResponse(await hitosService.openHitoFile(ctx, id, hitoId, kind));
  });
}

export async function PUT(request: Request, { params }: Params) {
  return withContext(request, async (ctx) => {
    const { id, hitoId, kind } = await parse(params);
    return hitosService.uploadHitoFile(ctx, id, hitoId, kind, await readForm(request));
  });
}

export async function DELETE(request: Request, { params }: Params) {
  return withContext(request, async (ctx) => {
    const { id, hitoId, kind } = await parse(params);
    return hitosService.removeHitoFile(ctx, id, hitoId, kind);
  });
}
