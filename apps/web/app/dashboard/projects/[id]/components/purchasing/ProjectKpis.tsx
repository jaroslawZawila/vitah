"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { orderLabel, type ProjectPurchases, type PurchaseOrderListItem } from "@repo/core/contract";
import { cn } from "@/lib/utils";
import { useVatLabel } from "../../../../components/vat-basis";
import Kpi from "../obra/Kpi";
import { deviationTone } from "../construction/format";
import { usePurchaseFormat } from "./format";

/** The deviation over the closed lines (contracted − cost: an overrun is positive), or why there is none yet. */
export function DeviationKpi({ summary }: { summary: Pick<ProjectPurchases["summary"], "deviationCents" | "deviationBp" | "closedLines"> }) {
  const t = useTranslations("purchasing.kpis");
  const f = usePurchaseFormat();
  const vat = useVatLabel();
  const { deviationCents, deviationBp, closedLines } = summary;
  return (
    <Kpi
        label={vat(t("deviation"), "excl")}
        value={
          <span className={deviationTone(deviationCents)}>
            {deviationCents === null ? "—" : f.signedMoney(deviationCents)}
          </span>
        }
        hints={[
          deviationCents === null || deviationBp === null
            ? t("noneClosed")
            : t(deviationCents > 0 ? "overrunHint" : "savingHint", { pct: f.share(Math.abs(deviationBp)), count: closedLines }),
        ]}
      />
  );
}

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
  const vat = useVatLabel();
  const { costCents, contractedCents } = summary;
  const pct = costCents ? (contractedCents * 100) / costCents : 0;
  const first = late[0];

  return (
    <section aria-label={t("label")} className="grid grid-cols-2 gap-3.5 lg:grid-cols-4">
      <Kpi
        label={vat(t("contracted"), "excl")}
        value={f.money(contractedCents)}
        pct={pct}
        barTone="brand"
        hints={[t("contractedHint", { pct: f.ratio(contractedCents, costCents), cost: f.money(costCents) })]}
      />
      <DeviationKpi summary={summary} />
      <Kpi
        label={vat(t("toContract"), "excl")}
        value={f.money(summary.toContractCents)}
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
                date: f.date(first.expectedOn),
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
