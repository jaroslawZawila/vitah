"use client";

import { useTranslations } from "next-intl";
import type { ConstructionControl } from "@repo/core/contract";
import { cn } from "@/lib/utils";
import { useVatLabel } from "../../../../components/vat-basis";
import Kpi from "../obra/Kpi";
import { useControlFormat } from "./format";

/**
 * Presentational: the Resumen's first figures, all without VAT: the total budgeted (the contract price, margins in),
 * the current cost (what suppliers have invoiced) and the global value (core's: the total less the expected final
 * cost, i.e. the margin the obra is heading for, in € and %).
 */
export default function SummaryFigures({ control, className }: { control: ConstructionControl; className?: string }) {
  const t = useTranslations("construction.summary.value");
  const f = useControlFormat();
  const vat = useVatLabel();
  const { sales, cost, globalValue, budget } = control;

  return (
    <section aria-label={t("label")} className={cn("grid grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] gap-3.5", className)}>
      <Kpi
        label={vat(t("total"), "excl")}
        value={f.money(sales.contractCents)}
        hints={budget ? [t("totalHint", { number: budget.number })] : []}
      />
      <Kpi label={vat(t("cost"), "excl")} value={f.money(cost.supplierInvoicedCents)} hints={[t("costHint")]} />
      <Kpi
        label={vat(t("global"), "excl")}
        value={
          <span className={cn(globalValue.cents < 0 && "text-bad")}>
            {f.money(globalValue.cents)} <small>· {f.share(globalValue.bp)}</small>
          </span>
        }
        hints={[t("globalHint", { cost: f.money(cost.forecastCents) })]}
      />
    </section>
  );
}
