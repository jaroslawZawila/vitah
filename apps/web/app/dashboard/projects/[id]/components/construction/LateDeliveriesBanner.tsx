"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { orderLabel, type PurchaseOrderListItem } from "@repo/core/contract";
import { useControlFormat } from "./format";

/**
 * Presentational: material orders (Compras) past their expected delivery.
 * Only a warning: it never changes a chapter's state or dates.
 */
export default function LateDeliveriesBanner({
  orders,
  orderHref,
}: {
  /** The late ones only. */
  orders: PurchaseOrderListItem[];
  orderHref: (orderId: string) => string;
}) {
  const t = useTranslations("construction.lateDeliveries");
  const f = useControlFormat();
  if (orders.length === 0) return null;

  return (
    <div role="status" className="flex items-start gap-2.5 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3 text-[13.5px] text-warn">
      <Clock aria-hidden className="mt-0.5 size-[18px] flex-none" />
      <p className="m-0 min-w-0">
        <b>{t("title", { count: orders.length })}</b>{" "}
        {orders.map((order, index) => (
          <span key={order.id}>
            {index > 0 && "; "}
            <Link href={orderHref(order.id)} className="num underline">
              {orderLabel(order.number)}
            </Link>{" "}
            {order.supplierName}
            {order.chapterCodes.length > 0 && `, ${t("chapter", { codes: order.chapterCodes.join(", ") })}`}
            {order.expectedOn && `, ${t("expected", { date: f.shortDay(order.expectedOn) })}`}
          </span>
        ))}
        . {t("onlyWarning")}
      </p>
    </div>
  );
}
