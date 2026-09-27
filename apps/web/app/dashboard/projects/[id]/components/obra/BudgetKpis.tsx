"use client";

import { useTranslations } from "next-intl";
import type { BudgetRevision } from "@repo/core/contract";
import { useObraFormat } from "./format";
import Kpi from "./Kpi";
import kpiStyles from "./obra.module.css";

/** Presentational: a revision's total, VAT, surfaces and ratios. */
export default function BudgetKpis({ revision }: { revision: BudgetRevision }) {
  const t = useTranslations("obra.budget");
  const f = useObraFormat();
  const { previous } = revision;
  const per = (m2: number | null) => (m2 ? f.money(Math.round(revision.totalCents / m2)) : null);
  const perBuilt = per(revision.builtAreaM2);
  const perUseful = per(revision.usefulAreaM2);

  return (
    <section className={kpiStyles.kpis}>
      <Kpi
        label={t("total")}
        value={f.money(revision.totalCents)}
        hints={
          previous
            ? [t("vsPrevious", { delta: f.signedMoney(revision.totalCents - previous.totalCents), number: previous.number })]
            : []
        }
      />
      <Kpi
        label={t("withVat", { rate: f.share(revision.vatRateBp) })}
        value={f.money(revision.totalCents + revision.vatCents)}
        hints={[t("vat", { amount: f.money(revision.vatCents) })]}
      />
      <Kpi
        label={t("surfaces")}
        value={
          revision.builtAreaM2 ? t("built", { m2: f.decimal(revision.builtAreaM2) }) : <small>{t("notSet")}</small>
        }
        hints={revision.usefulAreaM2 ? [t("useful", { m2: f.decimal(revision.usefulAreaM2) })] : []}
      />
      <Kpi
        label={t("ratios")}
        value={perBuilt ? t("perBuilt", { amount: perBuilt }) : <small>{t("notSet")}</small>}
        hints={perUseful ? [t("perUseful", { amount: perUseful })] : []}
      />
    </section>
  );
}
