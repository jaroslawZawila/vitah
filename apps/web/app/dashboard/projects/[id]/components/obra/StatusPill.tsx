"use client";

import { useTranslations } from "next-intl";
import type { HitoStatus } from "@repo/core/contract";
import type { VariantProps } from "class-variance-authority";
import { Badge, type badgeVariants } from "@/components/ui/badge";

type Variant = VariantProps<typeof badgeVariants>["variant"];

const TONE: Record<HitoStatus, Variant> = {
  pending: "outline",
  active: "info",
  ready: "yel",
  signed: "default",
  invoiced: "warn",
  paid: "good",
};

/** Presentational: the status of a hito on the Pagos tab. */
export default function StatusPill({ status }: { status: HitoStatus }) {
  const t = useTranslations("obra.hitoStatus");
  return <Badge variant={TONE[status]}>{t(status)}</Badge>;
}
