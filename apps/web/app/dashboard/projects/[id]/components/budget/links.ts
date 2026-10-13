// Where the Budget tab's pages live (shared by server pages and client views).

export const TAB_PATH = {
  summary: "",
  lines: "/lines",
  options: "/options",
  texts: "/texts",
  conditions: "/conditions",
  revisions: "/revisions",
} as const;
export type BudgetTab = keyof typeof TAB_PATH;

/** The tabs under the header. Revisions opens from the revision menu instead. */
export const BUDGET_TABS = ["summary", "lines", "options", "texts", "conditions"] as const satisfies readonly BudgetTab[];

/** A budget page's URL, keeping the revision being viewed. */
export function budgetHref(projectId: string, path: string, revisionId?: string | null, extra: Record<string, string> = {}) {
  const query = new URLSearchParams({ ...(revisionId ? { revision: revisionId } : {}), ...extra }).toString();
  return `/dashboard/projects/${projectId}/budget${path}${query ? `?${query}` : ""}`;
}
