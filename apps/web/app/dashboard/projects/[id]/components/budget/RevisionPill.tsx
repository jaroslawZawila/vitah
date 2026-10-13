import type { ComponentProps } from "react";
import { useTranslations } from "next-intl";
import type { BudgetRevisionStatus, BudgetRevisionSummary } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { useObraFormat } from "../obra/format";

const VARIANT: Record<BudgetRevisionStatus, "outline" | "info" | "good" | "destructive" | "warn"> = {
  draft: "outline",
  issued: "info",
  accepted: "good",
  rejected: "destructive",
  superseded: "outline",
};

/**
 * Presentational: "Rev.1 · Borrador" as a status pill. Other Badge props pass
 * through (`render` makes it a button, `children` follow the label).
 */
export default function RevisionPill({
  number,
  status,
  children,
  ...props
}: { number: number; status: BudgetRevisionStatus } & Omit<ComponentProps<typeof Badge>, "variant">) {
  const t = useTranslations("budget");
  return (
    <Badge variant={VARIANT[status]} {...props}>
      {t("statusPill", { number, status: t(`status.${status}`) })}
      {children}
    </Badge>
  );
}

/** A revision's dates as one line: "Emitida el 14 oct 2026 · aceptada el 2 nov 2026". */
export function useRevisionDates() {
  const t = useTranslations("budget.revisions");
  const f = useObraFormat();
  return (r: BudgetRevisionSummary) =>
    [
      r.issuedOn ? t("issuedOn", { date: f.date(r.issuedOn) }) : t("draft"),
      r.acceptedAt && t("acceptedOn", { date: f.date(r.acceptedAt.slice(0, 10)) }),
    ]
      .filter(Boolean)
      .join(" · ");
}
