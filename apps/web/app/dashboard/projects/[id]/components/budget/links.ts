// Where the Budget tab's pages live (shared by server pages and client views).

export const BUDGET_TABS = ["summary", "lines", "options", "texts", "conditions", "revisions"] as const;
export type BudgetTab = (typeof BUDGET_TABS)[number];

export const TAB_PATH: Record<BudgetTab, string> = {
  summary: "",
  lines: "/lines",
  options: "/options",
  texts: "/texts",
  conditions: "/conditions",
  revisions: "/revisions",
};

/** A budget page's URL, keeping the revision being viewed. */
export function budgetHref(projectId: string, path: string, revisionId?: string | null, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({ ...(revisionId ? { revision: revisionId } : {}), ...extra }).toString();
  return `/dashboard/projects/${projectId}/budget${path}${query ? `?${query}` : ""}`;
}
