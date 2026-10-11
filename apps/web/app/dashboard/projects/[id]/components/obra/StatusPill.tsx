"use client";

import { useTranslations } from "next-intl";
import type { HitoStatus, ProgressStatus } from "@repo/core/contract";
import type { VariantProps } from "class-variance-authority";
import { Badge, type badgeVariants } from "@/components/ui/badge";

type Variant = VariantProps<typeof badgeVariants>["variant"];

const TONE: Record<ProgressStatus | HitoStatus, Variant> = {
  pending: "outline",
  active: "info",
  ready: "yel",
  signed: "default",
  invoiced: "warn",
  done: "good",
  paid: "good",
};

/** Presentational: the status of a chapter ("status") or a hito ("hitoStatus"). */
export default function StatusPill({
  status,
  kind = "status",
}: {
  status: ProgressStatus | HitoStatus;
  kind?: "status" | "hitoStatus";
}) {
  const t = useTranslations(`obra.${kind}`);
  return <Badge variant={TONE[status]}>{t(status)}</Badge>;
}
