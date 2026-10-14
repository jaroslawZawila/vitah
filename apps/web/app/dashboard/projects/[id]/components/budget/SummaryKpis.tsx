"use client";

import { useTranslations } from "next-intl";
import type { BudgetRevision } from "@repo/core/contract";
import { useObraFormat } from "../obra/format";
import Kpi from "../obra/Kpi";
import InlinePct from "./InlinePct";

/**
 * Presentational: the works' price (the PEC), its two margins over the cost
 * (beneficio industrial and gastos asociados, % and €; the % editable on a
 * draft via `onMargins`, e.g. `{ profitPct: 6 }`) and €/m² built against the
 * tenant's average.
 */
export default function SummaryKpis({
  revision,
  onMargins,
}: {
  revision: BudgetRevision;
  onMargins?: (input: { overheadPct?: number; profitPct?: number }) => void;
}) {
  const t = useTranslations("budget.kpis");
  const f = useObraFormat();
  const { perM2Cents: perBuilt, builtAreaM2 } = revision;
  // The sum of the chapters' averages: what the tenant's budgets cost per m² built.
  const averages = Object.values(revision.ratios);
  const average = averages.length > 0 ? averages.reduce((sum, v) => sum + v, 0) : null;
  const withOptions = revision.status === "accepted" && revision.contractTotalCents !== revision.totalCents;

  const margin = (kind: "profit" | "overhead") => {
    const bp = revision[`${kind}Bp`];
    return (
      <Kpi
        label={t(kind)}
        value={f.money(revision[`${kind}Cents`])}
        hints={[
          onMargins ? (
            <span className="inline-flex items-center gap-1.5">
              <InlinePct label={t(`${kind}Label`)} bp={bp} onCommit={(pct) => onMargins({ [`${kind}Pct`]: pct })} />
              {t("onCostInput")}
            </span>
          ) : (
            t("onCost", { pct: f.share(bp) })
          ),
          // Lines are priced at cost: without a margin the work is sold at cost.
          ...(onMargins && bp === 0 ? [<span key="no-margin" className="font-semibold text-warn">{t("noMargin")}</span>] : []),
        ]}
      />
    );
  };

  return (
    <section className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        highlight
        label={t("work")}
        value={f.money(revision.totalCents)}
        hints={[
          t("workHint", { cost: f.money(revision.costCents), count: revision.lineCount }),
          t("withVat", { rate: f.share(revision.vatRateBp), total: f.money(revision.totalCents + revision.vatCents) }),
          ...(withOptions ? [t("contract", { amount: f.money(revision.contractTotalCents) })] : []),
        ]}
      />
      {margin("profit")}
      {margin("overhead")}
      <Kpi
        label={t("perBuilt")}
        value={perBuilt ? f.money(perBuilt) : <small>{t("noArea")}</small>}
        hints={[
          ...(builtAreaM2 ? [t("area", { area: f.decimal(builtAreaM2) })] : []),
          ...(perBuilt && average ? [t("perBuiltHint", { average: f.money(average), delta: f.ratio(perBuilt - average, average) })] : []),
        ]}
      />
    </section>
  );
}
