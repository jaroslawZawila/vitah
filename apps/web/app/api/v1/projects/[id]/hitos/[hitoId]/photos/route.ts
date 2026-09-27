import { hitosService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../lib/api";

// PUT { photoIds } — the project photos of the hito's acta fotográfica.

type Params = { params: Promise<{ id: string; hitoId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id, hitoId } = await params;
  return withContext(request, async (ctx) =>
    hitosService.setActaPhotos(ctx, id, hitoId, await readJson(request)),
  );
}
