// Proyectos › Presupuestos and the obra list beside a budget: matching the
// obras as typed, the ones before and after, and where switching obra goes.
// What each budget waits for is core's (`budgetSituation`, @repo/core/contract).

import type { BudgetOverviewItem } from "@repo/core/contract";
import { budgetHref } from "../../[id]/components/budget/links";
import { matchesObra, toObraOption } from "../obra-options";

/** The obras as the pickers match and show them. */
export const obraOptionsOf = (items: BudgetOverviewItem[]) =>
  items.map((i) => toObraOption({ id: i.projectId, ref: i.ref, address: i.address, clientName: i.clientName }));

/** The obras whose code, client or address has every word typed. */
export function searchBudgets(items: BudgetOverviewItem[], query: string) {
  if (!query.trim()) return items;
  const found = new Set(obraOptionsOf(items).filter((o) => matchesObra(o, query)).map((o) => o.id));
  return items.filter((i) => found.has(i.projectId));
}

/** The current obra's place in the list, and the obras before and after it (going round). */
export function neighbours(items: BudgetOverviewItem[], currentId: string) {
  const index = items.findIndex((i) => i.projectId === currentId);
  const at = (offset: number) => items[(index + offset + items.length) % items.length]!;
  return { index, previous: at(-1), next: at(1) };
}
export type Neighbours = ReturnType<typeof neighbours>;

/** The query a budget page keeps for another obra: the chapter (Partidas), not the revision. */
const KEPT_PARAMS = ["chapter"];

/**
 * The same budget page for another obra: `/dashboard/projects/A/budget/lines?chapter=06`
 * becomes `…/B/budget/lines?chapter=06`. Off a budget page, the other obra's budget.
 */
export function switchBudgetHref(pathname: string, search: string, projectId: string) {
  const page = /^\/dashboard\/projects\/[^/]+\/budget(\/[^?#]*)?$/.exec(pathname)?.[1] ?? "";
  const from = new URLSearchParams(search);
  const kept = Object.fromEntries(KEPT_PARAMS.flatMap((key) => (from.has(key) ? [[key, from.get(key)!]] : [])));
  return budgetHref(projectId, page, null, kept);
}
