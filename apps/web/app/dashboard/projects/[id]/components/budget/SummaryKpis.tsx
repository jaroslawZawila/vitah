"use client";

import { useTranslations } from "next-intl";
import type { BudgetRevision } from "@repo/core/contract";
import { useObraFormat } from "../obra/format";
import Kpi from "../obra/Kpi";

/** Presentational: the PEC, with VAT, €/m² against the tenant's average, and the options. */
export default function SummaryKpis({ revision, optionsHref }: { revision: BudgetRevision; optionsHref: string }) {
  const t = useTranslations("budget.kpis");
  const f = useObraFormat();
  const { lineCount: lines, perM2Cents: perBuilt } = revision;
  // The sum of the chapters' averages: what the tenant's budgets cost per m² built.
  const averages = Object.values(revision.ratios);
  const average = averages.length > 0 ? averages.reduce((sum, v) => sum + v, 0) : null;
  const { adding, subtracting } = revision.optionTotals;
  const accepted = revision.status === "accepted";

  return (
    <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi highlight label={t("pec")} value={f.money(revision.totalCents)} hints={[t("pecHint", { count: lines })]} />
      <Kpi
        label={t("withVat", { rate: f.share(revision.vatRateBp) })}
        value={f.money(revision.totalCents + revision.vatCents)}
        hints={[t("vat", { amount: f.money(revision.vatCents) })]}
      />
      <Kpi
        label={t("perBuilt")}
        value={perBuilt ? f.money(perBuilt) : <small>{t("noArea")}</small>}
        hints={perBuilt && average ? [t("perBuiltHint", { average: f.money(average), delta: f.ratio(perBuilt - average, average) })] : []}
      />
      {accepted ? (
        <Kpi label={t("contract")} value={f.money(revision.contractTotalCents)} hints={[t("contractHint")]} href={optionsHref} />
      ) : (
        <Kpi
          label={t("options")}
          value={t("optionsValue", { count: revision.options.length })}
          hints={revision.options.length > 0 ? [t("optionsHint", { plus: f.signedMoney(adding.cents), minus: f.money(subtracting.cents) })] : []}
          href={optionsHref}
        />
      )}
    </section>
  );
}
