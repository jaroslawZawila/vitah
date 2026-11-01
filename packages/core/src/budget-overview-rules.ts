import { ACTIVE_GENERATION_STATUSES, type BudgetOverviewItem } from "./contract";

// ─── Budget overview rules ───────────────────────────────────────────────────
// What Proyectos › Presupuestos says of each obra's budget, pure: the status
// filter it falls under and what it waits for (the AI, checks to tick, the
// client, an offer about to expire). Shared by ./budget-overview.ts (the
// totals) and the portal (the list), through @repo/core/contract.
// ─────────────────────────────────────────────────────────────────────────────

/** An issued budget this close to its "válido hasta" day (or past it) is flagged. */
export const BUDGET_EXPIRY_WARNING_DAYS = 7;
/** A €/m² built this far above the average (5 %) is flagged. */
export const BUDGET_PER_M2_WARNING_BP = 500;

export const BUDGET_FILTERS = ["all", "draft", "issued", "accepted", "rejected", "none"] as const;
export type BudgetFilter = (typeof BUDGET_FILTERS)[number];

/** Whether the AI is drafting an obra's first revision. */
export const isGenerating = (item: Pick<BudgetOverviewItem, "generation">) =>
  item.generation !== null && ACTIVE_GENERATION_STATUSES.includes(item.generation.status);

/** Whether an issued budget expires within the week, or has (`daysLeft` from today to its validity). */
export const expiresSoon = (daysLeft: number | null) => daysLeft !== null && daysLeft <= BUDGET_EXPIRY_WARNING_DAYS;

/** Whether a €/m² is far enough above the average to flag. */
export const perM2High = (deltaBp: number | null | undefined) => (deltaBp ?? 0) > BUDGET_PER_M2_WARNING_BP;

/** The filter an obra falls under: the AI drafting its first revision counts as a draft. */
export function budgetFilterOf(item: BudgetOverviewItem): Exclude<BudgetFilter, "all"> {
  const status = item.revision?.status;
  if (!status) return isGenerating(item) ? "draft" : "none";
  // Only an older revision is ever superseded; the newest one never is.
  return status === "superseded" ? "accepted" : status;
}

/** Each filter's count. */
export function budgetFilterCounts(items: BudgetOverviewItem[]): Record<BudgetFilter, number> {
  const counts = Object.fromEntries(BUDGET_FILTERS.map((f) => [f, 0])) as Record<BudgetFilter, number>;
  for (const item of items) counts[budgetFilterOf(item)] += 1;
  counts.all = items.length;
  return counts;
}

/** What an obra's budget waits for. */
export type BudgetSituation =
  | { kind: "generating"; step: number }
  | { kind: "failed" | "none" }
  | { kind: "checks"; count: number; number: number }
  | { kind: "draft"; number: number }
  | { kind: "expired" | "waiting"; issuedOn: string | null; validUntil: string | null }
  | { kind: "expiring"; days: number; issuedOn: string | null; validUntil: string | null }
  | { kind: "rejected"; date: string | null; next: number }
  | { kind: "accepted"; date: string | null; options: number };

export function budgetSituation(item: BudgetOverviewItem): BudgetSituation {
  const { revision, generation } = item;
  if (!revision) {
    if (generation && isGenerating(item)) return { kind: "generating", step: generation.step };
    return { kind: generation?.status === "failed" ? "failed" : "none" };
  }
  const { number, status, daysLeft, issuedOn, validUntil } = revision;
  if (status === "draft") {
    return revision.openChecks ? { kind: "checks", count: revision.openChecks, number } : { kind: "draft", number };
  }
  if (status === "issued") {
    if (daysLeft !== null && daysLeft < 0) return { kind: "expired", issuedOn, validUntil };
    if (daysLeft !== null && expiresSoon(daysLeft)) return { kind: "expiring", days: daysLeft, issuedOn, validUntil };
    return { kind: "waiting", issuedOn, validUntil };
  }
  if (status === "rejected") return { kind: "rejected", date: revision.rejectedOn, next: number + 1 };
  return { kind: "accepted", date: revision.acceptedOn, options: revision.chosenOptions };
}
