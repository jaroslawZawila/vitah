// The Proyectos list: each project with its budget's state and its obra stage,
// filtered by both and by what is typed. The filters live in the URL
// (`?presupuesto=accepted&obra=execution&q=…`), so going back keeps them.

import {
  BUDGET_FILTERS,
  budgetFilterOf,
  OBRA_FILTERS,
  obraFilterOf,
  type BudgetFilter,
  type BudgetState,
  type ObraFilter,
} from "@repo/core/contract";
import { matchesObra, projectObraOption, type ObraOption } from "./components/obra-options";

export type ProjectRow = ObraOption & {
  startDate: Date | null;
  completionDate: Date | null;
  obraStage: number;
  budget: BudgetState;
};

export type ProjectFilters = { budget: BudgetFilter; obra: ObraFilter; query: string };
export const NO_FILTERS: ProjectFilters = { budget: "all", obra: "all", query: "" };

/** The projects (core `listProjectsWithBudget`) as the list shows and searches them. */
export function toProjectRows(
  projects: {
    id: string;
    ref: string;
    address: string;
    startDate: Date | null;
    completionDate: Date | null;
    obraStage: number;
    client: { name: string | null; email: string } | null;
    budget: BudgetState;
  }[],
): ProjectRow[] {
  return projects.map((p) => ({
    ...projectObraOption(p),
    startDate: p.startDate,
    completionDate: p.completionDate,
    obraStage: p.obraStage,
    budget: p.budget,
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

/** The rows shown, and each option's count given the other filter and the search. */
export function filterProjects(rows: ProjectRow[], { budget, obra, query }: ProjectFilters) {
  const searched = rows.filter((row) => matchesObra(row, query));
  const inBudget = searched.filter((row) => budget === "all" || budgetOf(row) === budget);
  const inObra = searched.filter((row) => obra === "all" || obraOf(row) === obra);
  return {
    shown: inBudget.filter((row) => obra === "all" || obraOf(row) === obra),
    budgetCounts: tally(BUDGET_FILTERS, inObra, budgetOf),
    obraCounts: tally(OBRA_FILTERS, inBudget, obraOf),
  };
}

export const hasFilters = (filters: ProjectFilters) =>
  filters.budget !== "all" || filters.obra !== "all" || filters.query.trim() !== "";

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const pick = <K extends string>(keys: readonly K[], value: string | undefined): K =>
  keys.find((key) => key === value) ?? keys[0]!;

/** The filters in the page's search params; anything unknown is "all". */
export function parseFilters(params: Record<string, string | string[] | undefined>): ProjectFilters {
  return {
    budget: pick(BUDGET_FILTERS, one(params.presupuesto)),
    obra: pick(OBRA_FILTERS, one(params.obra)),
    query: one(params.q) ?? "",
  };
}

/** The filters as the list's query string ("" without any). */
export function filtersQuery({ budget, obra, query }: ProjectFilters) {
  const params = new URLSearchParams();
  if (budget !== "all") params.set("presupuesto", budget);
  if (obra !== "all") params.set("obra", obra);
  if (query.trim()) params.set("q", query);
  const search = params.toString();
  return search ? `?${search}` : "";
}
