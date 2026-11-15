import { warrantyService } from "@repo/core";
import { readJson, withContext } from "../../../../../../../lib/api";

// ─── /api/v1/projects/:id/warranty/:claimId ───────────────────────────────────
// GET   → WarrantyClaim: who sent it, its photos' ids and its whole history
// PATCH { status?, visitOn?, answer? } → { claimId } (admins and managers):
//       scheduled needs a visit day, rejected an answer (its reason); the
//       client is pushed when the status, the visit day or the answer changes
// ─────────────────────────────────────────────────────────────────────────────

type Params = { params: Promise<{ id: string; claimId: string }> };

export async function GET(request: Request, { params }: Params) {
  const { id, claimId } = await params;
  return withContext(request, (ctx) => warrantyService.getClaim(ctx, id, claimId));
}

export async function PATCH(request: Request, { params }: Params) {
  const { id, claimId } = await params;
  return withContext(request, async (ctx) => warrantyService.updateClaim(ctx, id, claimId, await readJson(request)));
}
