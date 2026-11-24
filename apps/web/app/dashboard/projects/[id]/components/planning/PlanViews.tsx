"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { PlanningCalendar, PlanningRow, PlanningRule, ProjectPlanning } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import Kpi from "../obra/Kpi";
import { muted } from "../obra/classes";
import { daysBetween, useControlFormat } from "../construction/format";
import { touchLink } from "../../../../components/touch";

// Presentational: Obra › Planificación's plan: the approved baseline and its
// key figures, an open draft, or the way to a first plan. The chapters
// themselves are in ../construction/ProgressViews.

type Baseline = NonNullable<ProjectPlanning["baseline"]>;

/** "Tras 03 · +5 d", "Desde el inicio", "Desde el 09/11", "Toda la obra". */
export function useRuleText() {
  const t = useTranslations("planning.rule");
  const f = useControlFormat();
  return (rule: PlanningRule) => {
    if (rule.spansWorks) return t("spans");
    if (rule.after) return rule.lagDays === 0 ? t("after", { code: rule.after }) : t("afterLag", { code: rule.after, lag: f.signedDays(rule.lagDays) });
    return rule.fixedStart ? t("fixed", { date: f.date(rule.fixedStart) }) : t("fromStart");
  };
}

/** "festivos nacionales y de Asturias, cierre de agosto y Navidad". */
export function useCalendarText() {
  const t = useTranslations("planning.calendar");
  return (calendar: PlanningCalendar) => {
    const parts = [t(`holidays.${calendar.region ?? "none"}`)];
    if (calendar.augustClosure) parts.push(t("august"));
    if (calendar.christmasClosure) parts.push(t("christmas"));
    return parts.join(", ");
  };
}

/** Days the forecast ends after the baseline (calendar days); 0 when on time or spanning the works. */
export const slipDays = (row: PlanningRow) => (row.spansWorks ? 0 : Math.max(0, daysBetween(row.plannedEnd, row.forecastEnd)));

/** The baseline's version, who approved it and why. */
export function BaselineBanner({ baseline }: { baseline: Baseline }) {
  const t = useTranslations("planning");
  const f = useControlFormat();
  return (
    <div className={cn(cardVariants(), "flex-row flex-wrap items-center gap-x-3.5 gap-y-2 py-3")}>
      <Badge variant="good">{t("baselineBadge", { number: baseline.number })}</Badge>
      <span className={muted}>
        {baseline.approvedAt &&
          (baseline.approvedBy
            ? t("approvedBy", { date: f.date(baseline.approvedAt), name: baseline.approvedBy })
            : t("approvedOn", { date: f.date(baseline.approvedAt) }))}
        {baseline.reason && <> · {t("reason", { reason: baseline.reason })}</>}
      </span>
    </div>
  );
}

/** The figures that matter: when it started, when the contract ends and where the works are heading. */
export function PlanKpis({ baseline, completionDate }: { baseline: Baseline; completionDate: string | null }) {
  const t = useTranslations("planning.kpis");
  const tp = useTranslations("planning");
  const f = useControlFormat();
  const { forecast } = baseline;
  const delay = forecast.delayDays;
  const late = delay !== null && delay > 0;
  return (
    // Two figures a row on a phone (from 360px), so the chapters come sooner.
    <section
      aria-label={t("label")}
      className="grid gap-3 min-[360px]:grid-cols-2 sm:grid-cols-[repeat(auto-fit,minmax(min(190px,100%),1fr))]"
    >
      <Kpi label={t("start")} value={f.date(baseline.startDate)} hints={[t("startHint")]} />
      <Kpi
        label={t("contract")}
        value={f.date(completionDate)}
        hints={[completionDate ? t("contractHint") : t("noContract")]}
      />
      <Kpi
        label={t("forecast")}
        value={<span className={cn(late && "text-warn")}>{f.date(forecast.endDate)}</span>}
        hints={[
          delay === null ? t("baselineEnd", { date: f.date(baseline.planned.endDate) }) : late ? t("late", { count: delay }) : tp("margin", { count: -delay }),
        ]}
      />
    </section>
  );
}

/**
 * No plan yet: says so, and offers staff the form for a first one (`form`,
 * unfolded on demand so the chapters below stay in view); viewers are told
 * who can make it.
 */
export function NoPlanNotice({ chapterCount, form }: { chapterCount: number; form?: React.ReactNode }) {
  const t = useTranslations("planning.generate");
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className={cn(cardVariants(), "flex-row flex-wrap items-center justify-between gap-3 border-dashed py-3")}>
        <p className="m-0 max-w-[90ch] text-sm leading-normal text-muted-foreground">
          <b className="text-foreground">{t("empty")}</b> {t("emptyHint", { count: chapterCount })}
        </p>
        {form ? (
          <Button type="button" variant={open ? "outline" : "default"} aria-expanded={open} onClick={() => setOpen((on) => !on)}>
            {t("open")}
          </Button>
        ) : (
          <span className={muted}>{t("viewerHint")}</span>
        )}
      </div>
      {open && form}
    </>
  );
}

/** An open draft: who made it, and the way into it. */
export function DraftNotice({
  draft,
  href,
  canManage,
}: {
  draft: NonNullable<ProjectPlanning["draft"]>;
  href: string;
  canManage: boolean;
}) {
  const t = useTranslations("planning.draftNotice");
  const f = useControlFormat();
  return (
    <div className={cn(cardVariants(), "flex-row flex-wrap items-center justify-between gap-3 border-yel/40 bg-yel-soft/40 py-3")}>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Badge variant="yel">{t("badge", { number: draft.number })}</Badge>
        <span className={muted}>{t("text", { name: draft.createdBy ?? "—", date: f.date(draft.createdAt) })}</span>
      </span>
      <Link
        href={href}
        className={cn("text-sm font-semibold text-brand-ink hover:underline", touchLink)}
      >
        {canManage ? t("edit") : t("view")}
      </Link>
    </div>
  );
}
