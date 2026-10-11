import { redirect } from "next/navigation";
import { BUDGET_PDF_KINDS, type BudgetPdfKind } from "@repo/core/contract";
import { getProjectBudget } from "../../../../../actions/budget";
import { budgetHref } from "../../components/budget/links";
import BudgetPdfScreen from "./BudgetPdfScreen";

/** A revision's PDF (`?kind=general|detailed`, `?revision=` for an older one). */
export default async function BudgetPdfPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ revision?: string; kind?: string }>;
}) {
  const [{ id }, { revision: revisionId, kind: rawKind }] = await Promise.all([params, searchParams]);
  const result = await getProjectBudget(id, revisionId);
  const revision = result?.budget.revision;
  if (!revision) redirect(`/dashboard/projects/${id}/budget`);
  const kind: BudgetPdfKind = BUDGET_PDF_KINDS.includes(rawKind as BudgetPdfKind) ? (rawKind as BudgetPdfKind) : "general";
  const newest = result.budget.revisions[0]?.id === revision.id;
  const param = newest ? null : revision.id;
  return (
    <BudgetPdfScreen
      backHref={budgetHref(id, "", param)}
      hrefs={{
        general: budgetHref(id, "/pdf", param, { kind: "general" }),
        detailed: budgetHref(id, "/pdf", param, { kind: "detailed" }),
      }}
      fileUrl={`/api/v1/projects/${id}/budget/revisions/${revision.id}/pdf?kind=${kind}`}
      kind={kind}
      draft={revision.status === "draft"}
    />
  );
}
