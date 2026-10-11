import { useTranslations } from "next-intl";
import type { BudgetRevisionStatus } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";

const VARIANT: Record<BudgetRevisionStatus, "outline" | "info" | "good" | "destructive" | "warn"> = {
  draft: "outline",
  issued: "info",
  accepted: "good",
  rejected: "destructive",
  superseded: "outline",
};

/** Presentational: "Rev.1 · Borrador" as a status pill. */
export default function RevisionPill({ number, status }: { number: number; status: BudgetRevisionStatus }) {
  const t = useTranslations("budget");
  return <Badge variant={VARIANT[status]}>{t("statusPill", { number, status: t(`status.${status}`) })}</Badge>;
}
