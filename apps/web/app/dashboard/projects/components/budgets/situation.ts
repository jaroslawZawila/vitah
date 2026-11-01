"use client";

import { useTranslations } from "next-intl";
import type { BudgetSituation } from "@repo/core/contract";
import { useObraFormat } from "../../[id]/components/obra/format";

type Kind = BudgetSituation["kind"];

/** Each situation's text colour. */
export const SITUATION_CLASS: Record<Kind, string> = {
  generating: "text-info",
  failed: "text-bad",
  none: "text-muted-foreground",
  checks: "text-yel",
  draft: "text-muted-foreground",
  expired: "text-bad",
  expiring: "text-warn",
  waiting: "text-info",
  rejected: "text-bad",
  accepted: "text-good",
};

/** The obra list's own flag where the situation's line is too long for it (`budgetsOverview.short`). */
const SHORT: Kind[] = ["failed", "checks", "draft", "waiting", "rejected"];

/** A situation in words: its line, the detail under it, and the short flag of the obra list. */
export function useSituationText() {
  const t = useTranslations("budgetsOverview");
  const f = useObraFormat();
  const date = (day: string | null) => (day ? f.date(day) : "—");
  const words = (s: BudgetSituation, short: boolean) => {
    const key = `${short && SHORT.includes(s.kind) ? "short" : "situation"}.${s.kind}`;
    if (s.kind === "checks") return t(key, { count: s.count });
    if (s.kind === "expiring") return t(key, { days: s.days });
    // The AI at work and no budget read as their pill does.
    if (short && (s.kind === "generating" || s.kind === "none")) return t(`pill.${s.kind}`);
    return t(key);
  };
  return {
    /** The obra list's flag for a €/m² well above the average. */
    perM2High: t("short.perM2High"),
    label: (s: BudgetSituation) => words(s, false),
    short: (s: BudgetSituation) => words(s, true),
    detail(s: BudgetSituation) {
      switch (s.kind) {
        case "generating":
          return t("situation.generatingSub", { step: s.step });
        case "failed":
        case "none":
          return t(`situation.${s.kind}Sub`);
        case "checks":
          return t("situation.checksSub", { number: s.number });
        case "draft":
          return t("situation.draftSub", { number: s.number });
        case "expired":
        case "expiring":
        case "waiting":
          return s.validUntil
            ? t("situation.issuedSub", { issued: date(s.issuedOn), valid: date(s.validUntil) })
            : t("situation.issuedOnly", { issued: date(s.issuedOn) });
        case "rejected":
          return t("situation.rejectedSub", { date: date(s.date), next: s.next });
        case "accepted":
          return t("situation.acceptedSub", { date: date(s.date), options: s.options });
      }
    },
  };
}
