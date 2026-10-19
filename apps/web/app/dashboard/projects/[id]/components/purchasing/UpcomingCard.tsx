"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { UPCOMING_DAYS, orderLabel, type PurchaseUpcoming } from "@repo/core/contract";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { cardTop } from "../construction/classes";
import { MockBadge } from "../construction/pills";
import { usePurchaseFormat } from "./format";

/**
 * Presentational: chapters whose orders must go out soon (or are late) with
 * lines nobody has ordered yet: planned start less the lead time, from
 * Planning (simulated without a baseline).
 */
export default function UpcomingCard({
  upcoming,
  planningMock,
  orderHref,
  newOrderHref,
}: {
  upcoming: PurchaseUpcoming[];
  planningMock: boolean;
  orderHref: (orderId: string) => string;
  /** A new order on a chapter's lines; omitted for viewers. */
  newOrderHref?: (chapterCode?: string) => string;
}) {
  const t = useTranslations("purchasing.upcoming");
  const tp = useTranslations("planning");
  const f = usePurchaseFormat();

  return (
    <section className={cn(cardVariants(), "gap-1")} aria-labelledby="upcoming-title">
      <div className={cardTop}>
        <h2 id="upcoming-title" className="text-[22px]">
          {t("title")}
        </h2>
        {planningMock && <MockBadge />}
      </div>
      <p className="text-[12.5px] text-muted-foreground">{t("text", { days: UPCOMING_DAYS })}</p>
      {upcoming.length === 0 ? (
        <p className="py-4 text-[13px] text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {upcoming.map((chapter) => (
            <li
              key={chapter.code}
              className="grid grid-cols-[40px_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b py-[11px] last:border-b-0"
            >
              <span className="num font-semibold">{chapter.code}</span>
              <div className="min-w-0">
                {newOrderHref ? (
                  <Link href={newOrderHref(chapter.code)} className="font-semibold hover:text-primary">
                    {chapter.name}
                  </Link>
                ) : (
                  <div className="font-semibold">{chapter.name}</div>
                )}
                <div className="text-[12px] text-muted-foreground">
                  {chapter.state === "in_progress"
                    ? t("started")
                    : chapter.plannedStart
                      ? t("starts", { date: f.shortDay(chapter.plannedStart) })
                      : t("noDate")}
                  {" · "}
                  {chapter.orderLateDays !== null ? (
                    <>
                      <span className="font-semibold text-warn">{t("orderLate", { days: chapter.orderLateDays })}</span>
                      {" · "}
                    </>
                  ) : (
                    chapter.orderBy && `${tp("orderBy", { date: f.shortDay(chapter.orderBy) })} · `
                  )}
                  {chapter.pendingOrders.length > 0 ? (
                    chapter.pendingOrders.map((order, index) => (
                      <span key={order.id}>
                        {index > 0 && ", "}
                        <Link href={orderHref(order.id)} className="num font-medium text-brand-ink hover:text-primary">
                          {orderLabel(order.number)}
                        </Link>
                      </span>
                    ))
                  ) : (
                    t("lines", { count: chapter.uncontractedLines })
                  )}
                  {chapter.pendingOrders.length > 0 && ` ${t("notSent", { count: chapter.pendingOrders.length })}`}
                </div>
              </div>
              <span className="num text-[13px]">{f.moneyRound(chapter.uncontractedCostCents)}</span>
            </li>
          ))}
        </ul>
      )}
      {newOrderHref && (
        <Link href={newOrderHref(upcoming[0]?.code)} className={cn(buttonVariants({ variant: "outline" }), "mt-3 w-full")}>
          {t("order")}
        </Link>
      )}
    </section>
  );
}
