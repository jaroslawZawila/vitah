import { budgetExclusionsService } from "@repo/core";
import { readJson, withContext } from "../../../../../../lib/api";

// One line of the tenant's library of "Gastos no incluidos" (admins, managers).
// Budgets keep the text they ticked: neither call changes one.
// PATCH  { label } → ExclusionPreset (409 exclusion_exists: another line says it)
// DELETE → { id } (kept as a deleted row; never shown again)

type Params = { params: Promise<{ presetId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { presetId } = await params;
  return withContext(request, async (ctx) => budgetExclusionsService.updateExclusionPreset(ctx, presetId, await readJson(request)));
}

export async function DELETE(request: Request, { params }: Params) {
  const { presetId } = await params;
  return withContext(request, (ctx) => budgetExclusionsService.deleteExclusionPreset(ctx, presetId));
}
