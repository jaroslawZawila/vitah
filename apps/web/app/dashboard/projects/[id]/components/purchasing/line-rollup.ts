import {
  daysBetween,
  PURCHASE_PROGRESS,
  UPCOMING_DAYS,
  type ChapterState,
  type PurchaseLineItem,
  type PurchaseProgress,
} from "@repo/core/contract";

// Pure: a chapter of Compras by budget line folded into one row, from the
// lines it shows (the page's data; nothing is fetched).

export type LineRollup = {
  lines: number;
  costCents: number;
  contractedCents: number;
  /** Over its closed lines; null while none is closed (an open line is never a saving). */
  deviationCents: number | null;
  /** The lines the deviation is over. */
  closedLines: number;
  invoicedCents: number;
  paidCents: number;
  /** Its lines by state. */
  counts: Record<PurchaseProgress, number>;
  /** Lines with an invoice past due and something owed. */
  overdue: number;
  /** Material orders past their expected delivery, each once. */
  lateOrders: number;
};

/** The lines' totals: each the sum of what the lines show. */
export function rollUpLines(lines: PurchaseLineItem[]): LineRollup {
  const counts = Object.fromEntries(PURCHASE_PROGRESS.map((p) => [p, 0])) as Record<PurchaseProgress, number>;
  const late = new Set<string>();
  let deviationCents: number | null = null;
  let closedLines = 0;
  let costCents = 0;
  let contractedCents = 0;
  let invoicedCents = 0;
  let paidCents = 0;
  let overdue = 0;
  for (const line of lines) {
    costCents += line.costCents;
    contractedCents += line.contractedCents;
    invoicedCents += line.invoicedCents;
    paidCents += line.paidCents;
    if (line.deviationCents !== null) {
      deviationCents = (deviationCents ?? 0) + line.deviationCents;
      closedLines++;
    }
    counts[line.progress]++;
    if (line.overdue) overdue++;
    for (const order of line.orders) if (order.lateDays !== null) late.add(order.id);
  }
  return {
    lines: lines.length,
    costCents,
    contractedCents,
    deviationCents,
    closedLines,
    invoicedCents,
    paidCents,
    counts,
    overdue,
    lateOrders: late.size,
  };
}

/**
 * A chapter not finished whose lines still to contract must be ordered within
 * `UPCOMING_DAYS` (its planned start less the lead time), or should have
 * been: the day, and how many days late (0 if not yet). Null otherwise; a
 * finished chapter is never "to order soon", as in core's "Por contratar pronto".
 */
export function orderSoon(
  chapter: { state: ChapterState; orderBy: string | null; lines: Pick<PurchaseLineItem, "progress">[] },
  today: string,
): { orderBy: string; lateDays: number } | null {
  const { orderBy } = chapter;
  if (chapter.state === "finished" || orderBy === null || !chapter.lines.some((l) => l.progress === "to_contract")) return null;
  const left = daysBetween(today, orderBy);
  if (left > UPCOMING_DAYS) return null;
  return { orderBy, lateDays: Math.max(0, -left) };
}
