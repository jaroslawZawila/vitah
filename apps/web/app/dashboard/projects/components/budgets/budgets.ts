// Proyectos › Presupuestos: matching the obras as typed.
// What each budget waits for is core's (`budgetSituation`, @repo/core/contract).

import type { BudgetOverviewItem } from "@repo/core/contract";
import { matchesObra, toObraOption } from "../obra-options";

/** The obras as the search matches them. */
const obraOptionsOf = (items: BudgetOverviewItem[]) =>
  items.map((i) => toObraOption({ id: i.projectId, ref: i.ref, address: i.address, clientName: i.clientName }));

/** The obras whose code, client or address has every word typed. */
export function searchBudgets(items: BudgetOverviewItem[], query: string) {
  if (!query.trim()) return items;
  const found = new Set(obraOptionsOf(items).filter((o) => matchesObra(o, query)).map((o) => o.id));
  return items.filter((i) => found.has(i.projectId));
}
