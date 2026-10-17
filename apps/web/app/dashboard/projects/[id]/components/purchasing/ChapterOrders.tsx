"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { orderLabel, type PurchaseOrderListItem } from "@repo/core/contract";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { cardTop, moreLink } from "../construction/classes";
import { usePurchaseFormat } from "./format";
import { LatePill, PurchaseStatusPill } from "./pills";

/** Presentational: a chapter's orders (Compras) on its Obra page, with a way to order more. */
export default function ChapterOrders({
  orders,
  orderHref,
  purchasesHref,
  newOrderHref,
}: {
  orders: PurchaseOrderListItem[];
  orderHref: (order: PurchaseOrderListItem) => string;
  purchasesHref: string;
  /** Omitted for viewers. */
  newOrderHref?: string;
}) {
  const t = useTranslations("purchasing.chapter");
  const f = usePurchaseFormat();

  return (
    <section
      className={cn(cardVariants(), "gap-2")}
      aria-labelledby="chapter-orders"
    >
      <div className={cardTop}>
        <h2 id="chapter-orders">
          {t("title")}{" "}
          <span className="num text-muted-foreground">{orders.length}</span>
        </h2>
        <div className="flex flex-wrap items-center gap-x-4">
          {newOrderHref && (
            <Link href={newOrderHref} className={moreLink}>
              + {t("new")}
            </Link>
          )}
          <Link href={purchasesHref} className={moreLink}>
            {t("all")} →
          </Link>
        </div>
      </div>
      {orders.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {orders.map((order) => (
            <li
              key={order.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b py-2.5 text-[13.5px] last:border-b-0"
            >
              <Link
                href={orderHref(order)}
                className="num font-semibold text-brand-ink hover:text-primary"
              >
                {orderLabel(order.number)}
              </Link>
              <span className="min-w-0 flex-[1_1_180px]">
                <b className="font-semibold">{order.supplierName}</b>
                <span className="text-muted-foreground">
                  {" "}
                  · {order.description}
                </span>
              </span>
              {order.lateDays !== null && <LatePill days={order.lateDays} />}
              <PurchaseStatusPill status={order.status} />
              <span className="num ml-auto">{f.amount(order.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
