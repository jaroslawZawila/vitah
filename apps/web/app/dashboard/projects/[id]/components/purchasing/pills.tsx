"use client";

import { useTranslations } from "next-intl";
import type { VariantProps } from "class-variance-authority";
import type {
  CompanyStatus,
  PurchaseInvoiceState,
  PurchaseKind,
  PurchaseProgress,
  PurchaseRequestStatus,
  PurchaseStatus,
} from "@repo/core/contract";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import { COMPANY_STATUS_VARIANT } from "../../../../subcontratas/components/display";
import { Dot } from "../construction/pills";

// Presentational: the Compras pages' pills.

type Variant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

const PURCHASE_STATUS_TONE: Record<PurchaseStatus, Variant> = {
  pending: "outline",
  ordered: "info",
  confirmed: "default",
  in_transit: "yel",
  delivered: "good",
  contracted: "info",
  finished: "good",
  cancelled: "destructive",
};

export function PurchaseStatusPill({ status, className }: { status: PurchaseStatus; className?: string }) {
  const t = useTranslations("purchasing.status");
  return (
    <Badge variant={PURCHASE_STATUS_TONE[status]} className={className}>
      <Dot />
      {t(status)}
    </Badge>
  );
}

const REQUEST_STATUS_TONE: Record<PurchaseRequestStatus, Variant> = {
  pending: "yel",
  approved: "info",
  ordered: "good",
  rejected: "destructive",
  cancelled: "outline",
};

/** A purchase request's state: por aprobar, aprobada, pedida, rechazada or cancelada. */
export function RequestStatusPill({ status, className }: { status: PurchaseRequestStatus; className?: string }) {
  const t = useTranslations("purchasing.requests.status");
  return (
    <Badge variant={REQUEST_STATUS_TONE[status]} className={className}>
      <Dot />
      {t(status)}
    </Badge>
  );
}

export function PurchaseKindPill({ kind }: { kind: PurchaseKind }) {
  const t = useTranslations("purchasing.kind");
  return <Badge variant="outline">{t(kind)}</Badge>;
}

/** "3 d tarde": a material order past its expected delivery. */
export function LatePill({ days }: { days: number }) {
  const t = useTranslations("purchasing");
  return (
    <Badge variant="warn">
      <Dot />
      {t("lateDays", { days })}
    </Badge>
  );
}

/** A supplier's CAE standing: "Sin CAE" for a material supplier, else apta / pendiente / bloqueada. */
export function SupplierCaePill({ suppliesOnly, status }: { suppliesOnly: boolean; status: CompanyStatus }) {
  const t = useTranslations("purchasing.cae");
  if (suppliesOnly) return <Badge variant="outline">{t("none")}</Badge>;
  return (
    <Badge variant={COMPANY_STATUS_VARIANT[status]}>
      <Dot />
      {t(status)}
    </Badge>
  );
}

const INVOICE_STATE_TONE: Record<PurchaseInvoiceState, Variant> = {
  pending: "info",
  partial: "yel",
  overdue: "destructive",
  paid: "good",
  credit: "outline",
};

/** A supplier invoice's state: por pagar, pago parcial, vencida, pagada, or abono. */
export function InvoiceStatePill({ state, className }: { state: PurchaseInvoiceState; className?: string }) {
  const t = useTranslations("purchasing.invoiceState");
  return (
    <Badge variant={INVOICE_STATE_TONE[state]} className={className}>
      <Dot />
      {t(state)}
    </Badge>
  );
}

const PROGRESS_TONE: Record<PurchaseProgress, Variant> = {
  to_contract: "outline",
  contracted: "info",
  invoiced: "yel",
  paid: "good",
};

/** Where a budget line (or a milestone) stands: the four states. */
export function ProgressPill({ progress, className }: { progress: PurchaseProgress; className?: string }) {
  const t = useTranslations("purchasing.progress");
  return (
    <Badge variant={PROGRESS_TONE[progress]} className={className}>
      <Dot />
      {t(progress)}
    </Badge>
  );
}
