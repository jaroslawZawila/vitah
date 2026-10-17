"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { orderLabel, type ProjectPurchases, type PurchaseOrderListItem } from "@repo/core/contract";
import { cn } from "@/lib/utils";
import Kpi from "../obra/Kpi";
import { deviationTone } from "../construction/format";
import { usePurchaseFormat } from "./format";

/**
 * Presentational: the project's Compras at a glance: contracted against the
 * cost, the deviation over closed lines, what is left to contract and the
 * late deliveries.
 */
export default function ProjectKpis({
  summary,
  late,
  orderHref,
}: {
  summary: ProjectPurchases["summary"];
  /** The orders delivering late, the worst first. */
  late: PurchaseOrderListItem[];
  orderHref: (order: PurchaseOrderListItem) => string;
}) {
  const t = useTranslations("purchasing.kpis");
  const f = usePurchaseFormat();
  const { costCents, contractedCents, deviationCents, deviationBp, closedLines } = summary;
  const pct = costCents ? (contractedCents * 100) / costCents : 0;
  const first = late[0];

  return (
    <section aria-label={t("label")} className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      <Kpi
        label={t("contracted")}
        value={f.moneyRound(contractedCents)}
        pct={pct}
        barTone="brand"
        hints={[t("contractedHint", { pct: f.ratio(contractedCents, costCents), cost: f.moneyRound(costCents) })]}
      />
      <Kpi
        label={t("deviation")}
        value={
          <span className={deviationTone(deviationCents)}>
            {deviationCents === null ? "—" : `${f.signedEuros(deviationCents)} €`}
          </span>
        }
        hints={[
          deviationCents === null || deviationBp === null
            ? t("noneClosed")
            : t(deviationCents < 0 ? "overrunHint" : "savingHint", { pct: f.share(Math.abs(deviationBp)), count: closedLines }),
        ]}
      />
      <Kpi
        label={t("toContract")}
        value={f.moneyRound(summary.toContractCents)}
        hints={[t("toContractHint", { lines: summary.uncontractedLines, pending: summary.pendingOrders })]}
      />
      <Kpi
        label={t("late")}
        value={<span className={cn(summary.lateDeliveries > 0 && "text-warn")}>{summary.lateDeliveries}</span>}
        className={cn(summary.lateDeliveries > 0 && "border-warn/40")}
        hints={[
          first ? (
            <>
              <Link href={orderHref(first)} className="font-semibold text-brand-ink hover:text-primary">
                {orderLabel(first.number)}
              </Link>{" "}
              {t("lateHint", {
                supplier: first.supplierName,
                date: first.expectedOn ? f.shortDay(first.expectedOn) : "—",
                days: first.lateDays ?? 0,
              })}
            </>
          ) : (
            t("noneLate")
          ),
        ]}
      />
    </section>
  );
}
