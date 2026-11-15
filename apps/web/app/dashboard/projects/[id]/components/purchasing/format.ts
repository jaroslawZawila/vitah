"use client";

import type { PurchaseOrderListItem } from "@repo/core/contract";
import { todayInSpain } from "@repo/core/obra-calc";
import { useControlFormat } from "../construction/format";

/** A timestamp's day in Spain. */
export const day = (iso: string) => todayInSpain(new Date(iso));

/** The Obra tab's figures, plus an order's delivery or works period ("14 oct 2026", "20 oct 2026 – 7 nov 2026"). */
export function usePurchaseFormat() {
  const f = useControlFormat();
  return {
    ...f,
    /** A material order's expected delivery, or a subcontract's works period; null when it has none. */
    when: (order: Pick<PurchaseOrderListItem, "kind" | "expectedOn" | "workStart" | "workEnd">) => {
      if (order.kind === "material") return order.expectedOn ? f.date(order.expectedOn) : null;
      if (order.workStart && order.workEnd) return f.dateRange(order.workStart, order.workEnd);
      const day = order.workStart ?? order.workEnd;
      return day ? f.date(day) : null;
    },
  };
}
