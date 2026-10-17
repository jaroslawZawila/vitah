"use client";

import { useTranslations } from "next-intl";
import type { CompanyStatus, DocState, WorkerAccessStatus } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { ACCESS_VARIANT, COMPANY_STATUS_VARIANT, DOC_STATE_VARIANT } from "./display";

// Presentational: the status pills of the Subcontratas pages.

const Dot = () => <span aria-hidden className="size-1.5 rounded-full bg-current" />;

export function CompanyStatusBadge({ status, className }: { status: CompanyStatus; className?: string }) {
  const t = useTranslations("subcontractors.status");
  return (
    <Badge variant={COMPANY_STATUS_VARIANT[status]} className={className}>
      <Dot />
      {t(status)}
    </Badge>
  );
}

export function AccessBadge({ status, className }: { status: WorkerAccessStatus; className?: string }) {
  const t = useTranslations("subcontractors.access");
  return (
    <Badge variant={ACCESS_VARIANT[status]} className={className}>
      <Dot />
      {t(status)}
    </Badge>
  );
}

/**
 * A document's state. Expiring documents count down ("18 días"); `short` is the
 * compact form for table cells (OK, Falta, Validar…).
 */
export function DocStateBadge({
  state,
  daysLeft,
  short = false,
  className,
}: {
  state: DocState;
  daysLeft: number | null;
  short?: boolean;
  className?: string;
}) {
  const t = useTranslations("subcontractors");
  const label =
    state === "expiring" && daysLeft !== null
      ? t("daysLeft", { count: daysLeft })
      : short
        ? t(`short.${state === "validated" ? "ok" : state}`)
        : t(`docState.${state}`);
  return (
    <Badge variant={DOC_STATE_VARIANT[state]} className={className}>
      {label}
    </Badge>
  );
}
