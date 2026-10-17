"use client";

import { useTranslations } from "next-intl";
import type { TenantPurchases } from "@repo/core/contract";
import { cn } from "@/lib/utils";
import Kpi from "../../projects/[id]/components/obra/Kpi";
import { usePurchaseFormat } from "../../projects/[id]/components/purchasing/format";

/** Presentational: the company's purchasing this year, what is open, not sent, and late. */
export default function CompanyKpis({
  summary,
  today,
  lateRefs,
}: {
  summary: TenantPurchases["summary"];
  today: string;
  /** The obras with a late delivery. */
  lateRefs: string[];
}) {
  const t = useTranslations("purchasing.company.kpis");
  const f = usePurchaseFormat();
  const late = summary.lateDeliveries;

  return (
    <section aria-label={t("label")} className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      <Kpi
        label={t("year", { year: today.slice(0, 4) })}
        value={f.moneyRound(summary.yearContractedCents)}
        hints={[t("yearHint", { orders: summary.yearOrders, projects: summary.yearProjects })]}
      />
      <Kpi label={t("open")} value={f.moneyRound(summary.openCents)} hints={[t("openHint", { count: summary.openOrders })]} />
      <Kpi label={t("pending")} value={f.moneyRound(summary.pendingCents)} hints={[t("pendingHint", { count: summary.pendingOrders })]} />
      <Kpi
        label={t("late")}
        value={<span className={cn(late > 0 && "text-warn")}>{late}</span>}
        className={cn(late > 0 && "border-warn/40")}
        hints={[late > 0 ? t("lateIn", { refs: lateRefs.join(", ") }) : t("noneLate")]}
      />
    </section>
  );
}
