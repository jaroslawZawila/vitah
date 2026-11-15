import { EXECUTION_STAGE, type ProjectSignals } from "./contract";

// ─── Project filters ─────────────────────────────────────────────────────────
// Where an obra stands on the Proyectos list's "Obra" filter, from the stage
// staff set (`projects.obra_stage`): before construction (1–5), under
// construction (6) or past it (handover, warranty). The budget filter is
// ./budget-overview-rules' `budgetFilterOf`. The "Atención" filter and its
// order read the obra's signals (./project-signals). Pure, through @repo/core/contract.
// ─────────────────────────────────────────────────────────────────────────────

export const OBRA_FILTERS = ["all", "not_started", "execution", "finished"] as const;
export type ObraFilter = (typeof OBRA_FILTERS)[number];

/** The filter an obra falls under, by its stage. */
export function obraFilterOf(stage: number): Exclude<ObraFilter, "all"> {
  if (stage < EXECUTION_STAGE) return "not_started";
  return stage === EXECUTION_STAGE ? "execution" : "finished";
}

/** The "Atención" filter: every obra, those that need something (late or a reason), or only the late ones. */
export const ATTENTION_FILTERS = ["all", "attention", "late"] as const;
export type AttentionFilter = (typeof ATTENTION_FILTERS)[number];

type Signals = Pick<ProjectSignals, "schedule" | "attention">;

export const isLate = (obra: Signals) => obra.schedule?.status === "late";

/** Whether an obra falls under `filter`. "attention" takes the late ones too, with or without a reason. */
export function matchesAttention(filter: AttentionFilter, obra: Signals) {
  if (filter === "late") return isLate(obra);
  return filter === "all" || isLate(obra) || obra.attention.length > 0;
}

/** How many things wait for someone, all reasons together (the attention pill's figure). */
export const reasonCount = (attention: ProjectSignals["attention"]) => attention.reduce((total, a) => total + a.count, 0);

/** Most urgent first: the late ones, then the most kinds of reason, the most of them, the most days late. 0 on a tie. */
export function byUrgency(a: Signals, b: Signals) {
  return (
    Number(isLate(b)) - Number(isLate(a)) ||
    b.attention.length - a.attention.length ||
    reasonCount(b.attention) - reasonCount(a.attention) ||
    (b.schedule?.days ?? 0) - (a.schedule?.days ?? 0)
  );
}
