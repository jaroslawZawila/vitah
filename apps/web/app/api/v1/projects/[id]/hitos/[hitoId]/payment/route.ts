import { hitosService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../../lib/api";

// PUT { paidOn, amountCents? } (amount defaults to the hito's price with VAT) · DELETE

type Params = { params: Promise<{ id: string; hitoId: string }> };

export async function PUT(request: Request, { params }: Params) {
  const { id, hitoId } = await params;
  return withContext(request, async (ctx) =>
    hitosService.registerPayment(ctx, id, hitoId, await readJson(request)),
  );
}

export async function DELETE(request: Request, { params }: Params) {
  const { id, hitoId } = await params;
  return withContext(request, (ctx) => hitosService.cancelPayment(ctx, id, hitoId));
}
