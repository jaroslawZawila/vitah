"use client";

import { useTranslations } from "next-intl";
import { BUDGET_EXPIRY_WARNING_DAYS, BUDGET_PER_M2_WARNING_BP, type BudgetOverview } from "@repo/core/contract";
import { useObraFormat } from "../../[id]/components/obra/format";
import Kpi from "../../[id]/components/obra/Kpi";

/**
 * Presentational: the totals over every obra's budget: what is still to issue,
 * what waits on clients (and expires soon), what is contracted, and the
 * accepted ones' average €/m² built.
 */
export default function BudgetsKpis({ summary }: { summary: BudgetOverview["summary"] }) {
  const t = useTranslations("budgetsOverview.kpis");
  const f = useObraFormat();
  const warn = (text: string) => <span className="font-semibold text-warn">{text}</span>;
  const toIssue = summary.drafts + summary.generating;

  return (
    <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        label={t("drafts")}
        value={toIssue ? t("draftsValue", { count: toIssue }) : <small>{t("noDrafts")}</small>}
        hints={[
          ...(summary.generating ? [t("generating", { count: summary.generating })] : []),
          ...(summary.openChecks ? [t("openChecks", { count: summary.openChecks })] : []),
        ]}
      />
      <Kpi
        label={t("issued")}
        value={f.money(summary.issuedCents)}
        hints={[t("issuedCount", { count: summary.issued }), ...(summary.expiring ? [warn(t("expiring", { count: summary.expiring, days: BUDGET_EXPIRY_WARNING_DAYS }))] : [])]}
      />
      <Kpi highlight label={t("contract")} value={f.money(summary.contractCents)} hints={[t("accepted", { count: summary.accepted })]} />
      <Kpi
        label={t("perM2")}
        value={summary.averagePerM2Cents !== null ? f.money(summary.averagePerM2Cents) : <small>{t("noAverage")}</small>}
        hints={[t("perM2Hint"), ...(summary.aboveAverage ? [warn(t("aboveAverage", { count: summary.aboveAverage, pct: f.share(BUDGET_PER_M2_WARNING_BP) }))] : [])]}
      />
    </section>
  );
}
