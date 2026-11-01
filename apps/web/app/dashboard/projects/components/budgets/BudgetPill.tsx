import { useTranslations } from "next-intl";
import { isGenerating, type BudgetOverviewItem } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import RevisionPill from "../../[id]/components/budget/RevisionPill";

/** Presentational: an obra's budget as a pill: its newest revision, else the AI at work or none. */
export default function BudgetPill({ item }: { item: BudgetOverviewItem }) {
  const t = useTranslations("budgetsOverview.pill");
  if (item.revision) return <RevisionPill number={item.revision.number} status={item.revision.status} />;
  return isGenerating(item) ? <Badge variant="info">{t("generating")}</Badge> : <Badge variant="outline">{t("none")}</Badge>;
}
