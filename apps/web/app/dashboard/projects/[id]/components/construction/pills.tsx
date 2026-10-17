"use client";

import { useTranslations } from "next-intl";
import type { VariantProps } from "class-variance-authority";
import type { ChapterState, IssueKind, IssueStatus, MilestoneState } from "@repo/core/contract";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ScheduleTone } from "./schedule";

// Presentational: the Obra tab's status pills and source labels.

type Variant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

export const CHAPTER_TONE: Record<ChapterState, Variant> = {
  pending: "outline",
  in_progress: "default",
  finished: "good",
};

export const MILESTONE_TONE: Record<MilestoneState, Variant> = {
  pending: "outline",
  reached: "default",
  requested: "yel",
  invoiced: "info",
  collected: "good",
};

const ISSUE_STATUS_TONE: Record<IssueStatus, Variant> = { pending: "outline", review: "yel", resolved: "good" };

export const SCHEDULE_TONE: Record<ScheduleTone, Variant> = { good: "good", yel: "yel", warn: "warn", muted: "outline" };

/** The small dot pills lead with. */
export const Dot = () => <span aria-hidden className="size-1.5 rounded-full bg-current" />;

export function ChapterStatePill({ state }: { state: ChapterState }) {
  const t = useTranslations("construction.chapterState");
  return (
    <Badge variant={CHAPTER_TONE[state]}>
      <Dot />
      {t(state)}
    </Badge>
  );
}

export function MilestoneStatePill({ state }: { state: MilestoneState }) {
  const t = useTranslations("construction.milestoneState");
  return (
    <Badge variant={MILESTONE_TONE[state]}>
      <Dot />
      {t(state)}
    </Badge>
  );
}

export function IssueKindPill({ kind }: { kind: IssueKind }) {
  const t = useTranslations("construction.issueKind");
  return <Badge variant={kind === "issue" ? "warn" : "info"}>{t(kind)}</Badge>;
}

export function IssueStatusPill({ status }: { status: IssueStatus }) {
  const t = useTranslations("construction.issueStatus");
  return (
    <Badge variant={ISSUE_STATUS_TONE[status]}>
      <Dot />
      {t(status)}
    </Badge>
  );
}

/** Marks a figure that comes from a module that doesn't exist yet. */
export function MockBadge() {
  const t = useTranslations("construction.sources");
  return (
    <Badge variant="outline" className="px-1.5 py-0 text-[10.5px] tracking-[0.04em] uppercase" title={t("mockHint")}>
      {t("mock")}
    </Badge>
  );
}

/** A module a figure comes from, in bold; `mock` adds the "Simulado" badge so it isn't mistaken for real data. */
export function Source({ name, mock = false }: { name: string; mock?: boolean }) {
  return (
    <>
      <b className="font-semibold text-foreground/80">{name}</b>
      {mock && <MockBadge />}
    </>
  );
}

/** Where figures come from: "Plan: **Planificación** [Simulado]" (compose with `Source`). */
export function SourceLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground", className)}>
      {children}
    </span>
  );
}
