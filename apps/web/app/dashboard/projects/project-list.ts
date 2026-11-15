// The Proyectos list: each project with its budget's state, its obra stage and
// its signals (schedule, built %, what needs attention), filtered by the three
// and by what is typed. The filters live in the URL
// (`?presupuesto=accepted&obra=execution&atencion=attention&q=…`), so going back keeps them.

import {
  ATTENTION_FILTERS,
  BUDGET_FILTERS,
  budgetFilterOf,
  byUrgency,
  isLate,
  matchesAttention,
  OBRA_FILTERS,
  obraFilterOf,
  type AttentionFilter,
  type BudgetFilter,
  type BudgetState,
  type ObraFilter,
  type ProjectSignals,
} from "@repo/core/contract";
import { matchesObra, projectObraOption, type ObraOption } from "./components/obra-options";

export type ProjectRow = ObraOption &
  ProjectSignals & {
    startDate: Date | null;
    completionDate: Date | null;
    obraStage: number;
    budget: BudgetState;
  };

export type ProjectFilters = { budget: BudgetFilter; obra: ObraFilter; attention: AttentionFilter; query: string };
export const NO_FILTERS: ProjectFilters = { budget: "all", obra: "all", attention: "all", query: "" };

/** The projects (core `listProjectsWithBudget`) as the list shows and searches them. */
export function toProjectRows(
  projects: ({
    id: string;
    ref: string;
    address: string;
    startDate: Date | null;
    completionDate: Date | null;
    obraStage: number;
    client: { name: string | null; email: string } | null;
    budget: BudgetState;
  } & ProjectSignals)[],
): ProjectRow[] {
  return projects.map((p) => ({
    ...projectObraOption(p),
    startDate: p.startDate,
    completionDate: p.completionDate,
    obraStage: p.obraStage,
    budget: p.budget,
    schedule: p.schedule,
    progressPct: p.progressPct,
    attention: p.attention,
  }));
}

const budgetOf = (row: ProjectRow) => budgetFilterOf(row.budget);
const obraOf = (row: ProjectRow) => obraFilterOf(row.obraStage);

/** How many rows fall under each option, "all" being every one. */
function tally<K extends string>(keys: readonly ("all" | K)[], rows: ProjectRow[], keyOf: (row: ProjectRow) => K) {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<"all" | K, number>;
  for (const row of rows) counts[keyOf(row)] += 1;
  counts.all = rows.length;
  return counts;
}

/**
 * The rows shown, and each option's count given the other filters and the search. With the
 * Atención filter on, the most urgent first (core's `byUrgency`); else in the list's own order.
 */
export function filterProjects(rows: ProjectRow[], { budget, obra, attention, query }: ProjectFilters) {
  const searched = rows.filter((row) => matchesObra(row, query));
  const byBudget = (row: ProjectRow) => budget === "all" || budgetOf(row) === budget;
  const byObra = (row: ProjectRow) => obra === "all" || obraOf(row) === obra;
  const byAttention = (row: ProjectRow) => matchesAttention(attention, row);
  const shown = searched.filter((row) => byBudget(row) && byObra(row) && byAttention(row));
  const forAttention = searched.filter((row) => byBudget(row) && byObra(row));
  return {
    shown: attention === "all" ? shown : shown.sort(byUrgency),
    budgetCounts: tally(BUDGET_FILTERS, searched.filter((row) => byObra(row) && byAttention(row)), budgetOf),
    obraCounts: tally(OBRA_FILTERS, searched.filter((row) => byBudget(row) && byAttention(row)), obraOf),
    // The options overlap (a late obra needs attention too): each counts its own.
    attentionCounts: {
      all: forAttention.length,
      attention: forAttention.filter((row) => matchesAttention("attention", row)).length,
      late: forAttention.filter(isLate).length,
    } satisfies Record<AttentionFilter, number>,
  };
}

export const hasFilters = (filters: ProjectFilters) =>
  filters.budget !== "all" || filters.obra !== "all" || filters.attention !== "all" || filters.query.trim() !== "";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const pick = <K extends string>(keys: readonly K[], value: string | undefined): K =>
  keys.find((key) => key === value) ?? keys[0]!;

/** The filters in the page's search params; anything unknown is "all". */
export function parseFilters(params: Record<string, string | string[] | undefined>): ProjectFilters {
  return {
    budget: pick(BUDGET_FILTERS, one(params.presupuesto)),
    obra: pick(OBRA_FILTERS, one(params.obra)),
    attention: pick(ATTENTION_FILTERS, one(params.atencion)),
    query: one(params.q) ?? "",
  };
}

/** The filters as the list's query string ("" without any). */
export function filtersQuery({ budget, obra, attention, query }: ProjectFilters) {
  const params = new URLSearchParams();
  if (budget !== "all") params.set("presupuesto", budget);
  if (obra !== "all") params.set("obra", obra);
  if (attention !== "all") params.set("atencion", attention);
  if (query.trim()) params.set("q", query);
  const search = params.toString();
  return search ? `?${search}` : "";
}
