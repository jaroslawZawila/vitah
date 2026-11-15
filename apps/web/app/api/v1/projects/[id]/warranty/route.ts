import { warrantyService } from "@repo/core";
import { withContext } from "../../../../../../lib/api";

// GET /api/v1/projects/:id/warranty → ProjectWarranty: the home's hand-over,
// its three LOE periods and its warranty claims, newest first (every staff
// member). The client sends claims from the app (/api/mobile/warranty).

type Params = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id } = await params;
  return withContext(request, (ctx) => warrantyService.listClaims(ctx, id));
}
