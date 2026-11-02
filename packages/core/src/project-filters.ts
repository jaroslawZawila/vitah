import { EXECUTION_STAGE } from "./contract";

// ─── Project filters ─────────────────────────────────────────────────────────
// Where an obra stands on the Proyectos list's "Obra" filter, from the stage
// staff set (`projects.obra_stage`): before construction (1–5), under
// construction (6) or past it (handover, warranty). The budget filter is
// ./budget-overview-rules' `budgetFilterOf`. Pure, through @repo/core/contract.
// ─────────────────────────────────────────────────────────────────────────────

export const OBRA_FILTERS = ["all", "not_started", "execution", "finished"] as const;
export type ObraFilter = (typeof OBRA_FILTERS)[number];

/** The filter an obra falls under, by its stage. */
export function obraFilterOf(stage: number): Exclude<ObraFilter, "all"> {
  if (stage < EXECUTION_STAGE) return "not_started";
  return stage === EXECUTION_STAGE ? "execution" : "finished";
}
