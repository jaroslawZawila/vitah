import { budgetExclusionsService } from "@repo/core";
import { readJson, withContext } from "../../../../../lib/api";

// The tenant's library of "Gastos no incluidos": the lines a draft budget's
// Condiciones page offers as a checklist (ticking one is PATCH
// /api/v1/projects/:id/budget/revisions/:revisionId with `exclusion`).
// GET  → ExclusionPreset[] { id, label }, in order (any staff role; the template's lines the first time)
// POST { label } → 201 ExclusionPreset (the existing one for the same text) (admins, managers)

export function GET(request: Request) {
  return withContext(request, (ctx) => budgetExclusionsService.listExclusionPresets(ctx));
}

export function POST(request: Request) {
  return withContext(request, async (ctx) => budgetExclusionsService.createExclusionPreset(ctx, await readJson(request)), 201);
}
