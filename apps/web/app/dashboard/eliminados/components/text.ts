"use client";

import { useTranslations } from "next-intl";
import type { DeletedItem } from "@repo/core/contract";
import { useFormat } from "@/lib/format";

/**
 * A deleted record in words: what it is (`title`, with a second line), when
 * it was deleted and by whom, and why it can't be restored as things stand.
 */
export function useDeletedText() {
  const t = useTranslations("deletedPage");
  const format = useFormat();
  const day = format.date;
  const money = format.money;
  const parts = (...values: (string | null | false)[]) => values.filter(Boolean).join(" · ") || null;

  return {
    kind: (item: DeletedItem) => t(`kinds.${item.kind}`),
    title(item: DeletedItem): string {
      switch (item.kind) {
        case "photo":
          // Without a caption it is known by its day.
          return item.day && item.label === item.day ? t("what.photoOf", { date: day(item.day) }) : item.label;
        case "invoice":
          return t((item.amountCents ?? 0) < 0 ? "what.creditNote" : "what.invoice", { number: item.label });
        case "payment":
          return t("what.payment", { amount: money(item.amountCents ?? 0) });
        default:
          return item.label;
      }
    },
    detail(item: DeletedItem): string | null {
      switch (item.kind) {
        case "photo":
          return item.day && item.label !== item.day ? day(item.day) : null;
        case "issue_file":
          return item.detail ? t("what.issue", { number: item.detail }) : null;
        case "assignment":
          return t("what.assignment");
        case "invoice":
          return parts(item.detail, item.amountCents !== null && money(item.amountCents), item.day && day(item.day));
        case "payment":
          return parts(item.day && day(item.day), t("what.paymentOf", { number: item.label }), item.detail);
        default:
          return item.detail;
      }
    },
    /** "14 nov 2026, 10:02" in Spain's time. */
    when: (item: DeletedItem) => format.dateTime(item.deletedAt),
    by: (item: DeletedItem) => (item.deletedBy ? t("deletedBy", { name: item.deletedBy.name }) : t("deletedByUnknown")),
    /** Why it can't come back yet; null when it can. */
    blocked(item: DeletedItem): string | null {
      if (item.restorable === true) return null;
      if (item.restorable === "parent_deleted") {
        return t(item.parent?.kind === "invoice" ? "blocked.parent_invoice" : "blocked.parent_project", { label: item.parent?.label ?? "" });
      }
      return t(`blocked.${item.restorable}`, { label: item.label });
    },
  };
}
