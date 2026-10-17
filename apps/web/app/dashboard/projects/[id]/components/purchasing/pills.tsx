"use client";

import { useTranslations } from "next-intl";
import type { VariantProps } from "class-variance-authority";
import type { CompanyStatus, PurchaseKind, PurchaseStatus } from "@repo/core/contract";
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
