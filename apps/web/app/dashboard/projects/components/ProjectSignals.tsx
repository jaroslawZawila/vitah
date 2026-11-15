"use client";

import Link from "next/link";
import { Popover } from "@base-ui/react/popover";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { reasonCount, type ProjectAttention, type ProjectAttentionKind, type ProjectSchedule } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import { obraHref } from "../[id]/components/construction/ObraFrame";
import { useControlFormat } from "../[id]/components/construction/format";
import { SCHEDULE_TONE } from "../[id]/components/construction/pills";
import { STATUS_TONE } from "../[id]/components/construction/schedule";
import ProgressBar from "../[id]/components/obra/ProgressBar";

// Presentational: what the Proyectos list shows of each obra besides its budget
// and stage (core's project signals): whether it is on time, how much is built,
// and what waits for someone, each reason linking to where it is handled.

/** Where each reason is dealt with. */
export function attentionHref(projectId: string, kind: ProjectAttentionKind) {
  const project = `/dashboard/projects/${projectId}`;
  switch (kind) {
    case "to_invoice":
      return obraHref(projectId, "milestones");
    case "collection_overdue":
      return `${project}/payments`;
    case "supplier_overdue":
      return `/dashboard/compras/facturas?estado=overdue&obra=${projectId}`;
    case "requests":
      return `${project}/compras?vista=solicitudes`;
    case "late_deliveries":
      return `/dashboard/compras?obra=${projectId}&retraso=1`;
    case "documents":
      return obraHref(projectId);
  }
}

/** The schedule's pill: "Con retraso · +12 d", "En plazo", "Sin plan" (simulated dates) or "Sin fechas". */
export function SchedulePill({ schedule }: { schedule: ProjectSchedule }) {
  const t = useTranslations("projectsPage.signals");
  const ts = useTranslations("construction.scheduleStatus");
  const f = useControlFormat();
  const { status, worst, days } = schedule;
  const late = status === "late";
  return (
    <Badge variant={SCHEDULE_TONE[STATUS_TONE[status]]} title={late && worst ? ts(`worst.${worst}`) : ts(`caption.${status}`)}>
      {late ? t("late", { days: f.signedDays(days ?? 0) }) : ts(`headline.${status}`)}
    </Badge>
  );
}

/** The built %: a small bar (decorative) with the figure. */
export function ProgressFigure({ pct, className }: { pct: number; className?: string }) {
  const f = useFormat();
  return (
    <span className={cn("flex items-center gap-2", className)}>
      <ProgressBar pct={pct} className="w-14 min-w-0 flex-none" />
      <span className="num text-meta text-muted-foreground">{f.percent(pct * 100)}</span>
    </span>
  );
}

/** One reason as a sentence: "2 solicitudes por aprobar". */
function useReasonText() {
  const t = useTranslations("projectsPage.signals.reasons");
  const f = useControlFormat();
  return (reason: ProjectAttention) =>
    reason.amountCents !== undefined
      ? t(reason.kind, { count: reason.count, amount: f.money(reason.amountCents) })
      : t(reason.kind, { count: reason.count });
}

/**
 * The count of what needs attention, as a pill. Hovering or pressing it opens
 * the reasons, each a link to where it is handled; its label reads them all.
 */
export function AttentionPill({ projectId, projectRef, attention }: { projectId: string; projectRef: string; attention: ProjectAttention[] }) {
  const t = useTranslations("projectsPage.signals");
  const reasonText = useReasonText();
  const count = reasonCount(attention);
  const reasons = attention.map(reasonText);
  return (
    <Popover.Root>
      <Popover.Trigger
        openOnHover
        delay={150}
        aria-label={t("attentionLabel", { ref: projectRef, reasons: reasons.join(", ") })}
        className="inline-flex items-center rounded-full focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11"
      >
        <Badge variant="destructive">{t("attention", { count })}</Badge>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={6} className="isolate z-50 outline-none">
          <Popover.Popup className="max-w-[min(340px,calc(100vw-32px))] origin-(--transform-origin) rounded-[14px] border bg-popover p-3 text-popover-foreground shadow-modal outline-none">
            <Popover.Title className="eyebrow m-0 mb-1.5">{t("attentionTitle", { ref: projectRef })}</Popover.Title>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {attention.map((reason, i) => (
                <li key={reason.kind}>
                  <Link
                    href={attentionHref(projectId, reason.kind)}
                    className="flex min-h-8 items-center justify-between gap-3 rounded-md px-1.5 text-sm text-foreground underline-offset-2 hover:bg-raise hover:underline focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11"
                  >
                    {reasons[i]}
                    <ChevronRight aria-hidden className="size-3.5 flex-none text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** The reasons in a line of text (the phone's cards, which are links themselves). */
export function AttentionText({ attention, className }: { attention: ProjectAttention[]; className?: string }) {
  const reasonText = useReasonText();
  return <span className={cn("text-meta text-bad", className)}>{attention.map(reasonText).join(" · ")}</span>;
}
