import type { CostLine } from "@repo/core/contract";
import { deviation } from "@repo/core/control-calc";

// Pure: a chapter of Obra › Costes folded into one row, from the lines it
// shows (the page's data; nothing is fetched).

export type CostRollup = {
  lines: number;
  costCents: number;
  /** What its lines have contracted; null while none has anything. */
  contractedCents: number | null;
  /** Over its closed lines (an open one never counts); null while none is closed. */
  deviationCents: number | null;
  /** The deviation against the closed lines' cost, in basis points. */
  deviationBp: number | null;
  closed: number;
  open: number;
  /** Closed lines that cost more than budgeted. */
  overruns: number;
  /** Late material orders, each once. */
  lateOrders: number;
};

/** The lines' totals: each the sum of what the lines show. */
export function rollUpCosts(lines: CostLine[]): CostRollup {
  const late = new Set<string>();
  let costCents = 0;
  let contractedCents: number | null = null;
  let deviationCents: number | null = null;
  let closedCostCents = 0;
  let closed = 0;
  let open = 0;
  let overruns = 0;
  for (const line of lines) {
    costCents += line.costCents;
    if (line.contractedCents !== null) contractedCents = (contractedCents ?? 0) + line.contractedCents;
    if (line.contracting === "closed") closed++;
    if (line.contracting === "open") open++;
    if (line.deviationCents !== null) {
      deviationCents = (deviationCents ?? 0) + line.deviationCents;
      closedCostCents += line.costCents;
      if (line.deviationCents > 0) overruns++;
    }
    for (const order of line.orders) if (order.lateDays !== null) late.add(order.id);
  }
  return {
    lines: lines.length,
    costCents,
    contractedCents,
    // Core's arithmetic for a line, over the closed lines together.
    ...deviation(closedCostCents, deviationCents === null ? null : closedCostCents + deviationCents),
    closed,
    open,
    overruns,
    lateOrders: late.size,
  };
}
