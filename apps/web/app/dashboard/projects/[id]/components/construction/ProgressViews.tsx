"use client";

import Link from "next/link";
import { Fragment } from "react";
import { useTranslations } from "next-intl";
import { Camera, MessageSquareWarning } from "lucide-react";
import type { ChapterState, ControlChapter } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { groupRow } from "./classes";
import { daysBetween, useControlFormat } from "./format";
import { GanttBar, MonthAxis, type Timeline } from "./Gantt";
import { ChapterStatePill, SCHEDULE_TONE } from "./pills";
import { groupByState, scheduleOf } from "./schedule";
import { Dash, dateSpan } from "./SummaryTable";

// Presentational: Obra › Avance, the chapters with their plan against what
// happened: a table with a mini Gantt from 768px, cards on phones.

/** What staff can do on a chapter; each is omitted for viewers. */
export type ProgressActions = {
  onStart: (code: string) => void;
  onFinish: (code: string) => void;
  onCorrect: (code: string) => void;
  onIssue: (code: string) => void;
  onPhoto: (code: string) => void;
};

/** What to note under a chapter's name: how it stands against its plan, its open issues, its duration. */
function ChapterNotes({ chapter, today }: { chapter: ControlChapter; today: string }) {
  const t = useTranslations("construction.progress");
  const ts = useTranslations("construction.schedule");
  const f = useControlFormat();
  const schedule = scheduleOf(chapter, today);
  const pills: React.ReactNode[] = [];

  if (chapter.state === "in_progress" && schedule && schedule.key !== "onTime") {
    pills.push(
      <Badge key="schedule" variant={SCHEDULE_TONE[schedule.tone]}>
        {ts(schedule.key === "overdue" ? "overdueLong" : schedule.key, { days: f.signedDays(schedule.days), count: schedule.days })}
      </Badge>,
    );
  }
  if (chapter.state === "pending" && schedule?.key === "notStarted") {
    pills.push(
      <Badge key="schedule" variant="warn">
        {ts("notStarted", { days: f.signedDays(schedule.days) })}
      </Badge>,
    );
  }
  if (chapter.openIssues > 0) {
    pills.push(
      <Badge key="issues" variant="warn">
        {t("openIssues", { count: chapter.openIssues })}
      </Badge>,
    );
  }

  let note: string | null = null;
  if (chapter.state === "pending" && chapter.plannedStart && chapter.plannedStart >= today) {
    note = t("startsOn", { date: f.day(chapter.plannedStart) });
  }
  if (chapter.state === "finished" && chapter.actualDays !== null) {
    note =
      chapter.plannedDays !== null
        ? t("durationVsPlan", { actual: chapter.actualDays, planned: chapter.plannedDays })
        : t("duration", { days: chapter.actualDays });
  }

  if (pills.length === 0 && !note) return null;
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      {pills}
      {note && <span className={cn("text-[12px] text-muted-foreground", chapter.state === "finished" && "num")}>{note}</span>}
    </div>
  );
}

/** The buttons a chapter's state allows: Iniciar, Finalizar (and log an issue), or Corregir. */
function RowActions({
  chapter,
  actions,
  phone = false,
}: {
  chapter: ControlChapter;
  actions: ProgressActions;
  phone?: boolean;
}) {
  const t = useTranslations("construction.progress");
  const { code } = chapter;
  if (chapter.state === "pending") {
    return (
      <Button type="button" variant="outline" size={phone ? "default" : "sm"} onClick={() => actions.onStart(code)} aria-label={t("startLabel", { code })}>
        {t("start")}
      </Button>
    );
  }
  if (chapter.state === "finished") {
    return (
      <Button type="button" variant="ghost" size={phone ? "default" : "sm"} className="text-brand-ink" onClick={() => actions.onCorrect(code)} aria-label={t("correctLabel", { code })}>
        {phone ? t("correctDates") : t("correct")}
      </Button>
    );
  }
  return (
    <div className="flex items-center justify-end gap-1.5">
      <Button type="button" variant="ghost" size={phone ? "icon" : "icon-sm"} onClick={() => actions.onIssue(code)} aria-label={t("issueLabel", { code })} title={t("issueLabel", { code })}>
        <MessageSquareWarning aria-hidden />
      </Button>
      {phone && (
        <Button type="button" variant="ghost" size="icon" onClick={() => actions.onPhoto(code)} aria-label={t("photoLabel", { code })} title={t("photoLabel", { code })}>
          <Camera aria-hidden />
        </Button>
      )}
      <Button type="button" size={phone ? "default" : "sm"} onClick={() => actions.onFinish(code)} aria-label={t("finishLabel", { code })}>
        {t("finish")}
      </Button>
    </div>
  );
}

/** From 768px: the chapters grouped by state, with plan and actual dates and a mini Gantt. */
export function ProgressTable({
  chapters,
  timeline,
  today,
  chapterHref,
  actions,
}: {
  chapters: ControlChapter[];
  timeline: Timeline | null;
  today: string;
  chapterHref: (code: string) => string;
  actions?: ProgressActions;
}) {
  const t = useTranslations("construction.progress");
  const tg = useTranslations("construction.groups");
  const f = useControlFormat();
  const columns = 5 + (timeline ? 1 : 0) + (actions ? 1 : 0);

  return (
    <section className={cn(cardVariants({ size: "flush" }), "hidden py-1.5 md:flex")} aria-label={t("tableLabel")}>
      <Table className="text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead className="pl-[18px]">{t("code")}</TableHead>
            <TableHead>{t("chapter")}</TableHead>
            <TableHead>{t("state")}</TableHead>
            <TableHead>{t("plan")}</TableHead>
            <TableHead>{t("actual")}</TableHead>
            {timeline && (
              <TableHead className="w-[40%]">
                <MonthAxis timeline={timeline} />
              </TableHead>
            )}
            {actions && (
              <TableHead className="pr-[18px] text-right">
                <span className="sr-only">{t("actions")}</span>
              </TableHead>
            )}
          </TableRow>
        </TableHeader>
        <TableBody>
          {groupByState(chapters).map((group) => (
            <Fragment key={group.state}>
              <TableRow className={groupRow}>
                <TableCell colSpan={columns} className="pl-[18px]">
                  {tg(group.state, { count: group.chapters.length })}
                </TableCell>
              </TableRow>
              {group.chapters.map((chapter) => (
                <TableRow key={chapter.code}>
                  <TableCell className="num pl-[18px]">{chapter.code}</TableCell>
                  <TableCell className="min-w-[200px] whitespace-normal">
                    <Link href={chapterHref(chapter.code)} className="font-semibold transition-colors hover:text-primary">
                      {chapter.name}
                    </Link>
                    <ChapterNotes chapter={chapter} today={today} />
                  </TableCell>
                  <TableCell>
                    <ChapterStatePill state={chapter.state} />
                  </TableCell>
                  <TableCell className="num">{dateSpan(f, chapter.plannedStart, chapter.plannedEnd) ?? <Dash />}</TableCell>
                  <TableCell className="num">{dateSpan(f, chapter.actualStart, chapter.actualEnd) ?? <Dash />}</TableCell>
                  {timeline && (
                    <TableCell>
                      <GanttBar chapter={chapter} timeline={timeline} today={today} />
                    </TableCell>
                  )}
                  {actions && (
                    <TableCell className="pr-[18px] text-right">
                      <RowActions chapter={chapter} actions={actions} />
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </Fragment>
          ))}
        </TableBody>
      </Table>
    </section>
  );
}

/** How many of each group a phone shows while no state is picked (the rest is a tap away). */
const PHONE_LIMIT: Record<ChapterState, number | null> = { in_progress: null, pending: 2, finished: 1 };

/**
 * On phones: a card per chapter. With every state shown, all chapters in
 * progress, the next pending ones and the last finished; picking a state
 * shows all of it.
 */
export function ProgressCards({
  chapters,
  timeline,
  today,
  chapterHref,
  actions,
  showingAll,
  onShowState,
}: {
  chapters: ControlChapter[];
  timeline: Timeline | null;
  today: string;
  chapterHref: (code: string) => string;
  actions?: ProgressActions;
  /** No state filter: groups are shortened. */
  showingAll: boolean;
  onShowState: (state: ChapterState) => void;
}) {
  const t = useTranslations("construction.progress");
  const tg = useTranslations("construction.groups");
  const f = useControlFormat();

  return (
    <div className="flex flex-col gap-3 md:hidden">
      {groupByState(chapters).map((group) => {
        let list = group.chapters;
        const limit = showingAll ? PHONE_LIMIT[group.state] : null;
        if (limit !== null) {
          // The next to start, or the last to finish.
          list =
            group.state === "finished"
              ? [...list].sort((a, b) => (b.actualEnd ?? "").localeCompare(a.actualEnd ?? "")).slice(0, limit)
              : list.slice(0, limit);
        }
        const hidden = group.chapters.length - list.length;
        return (
          <section key={group.state} className="flex flex-col gap-2.5" aria-label={tg(group.state, { count: group.chapters.length })}>
            <h2 className="eyebrow mt-1 font-sans">
              {limit !== null ? tg(`${group.state}Phone`, { count: list.length }) : tg(group.state, { count: group.chapters.length })}
            </h2>
            {list.map((chapter) => {
              const plan = dateSpan(f, chapter.plannedStart, chapter.plannedEnd);
              const actual = dateSpan(f, chapter.actualStart, chapter.actualEnd);
              const soon = chapter.state === "pending" && chapter.plannedStart ? daysBetween(today, chapter.plannedStart) : null;
              return (
                <article key={chapter.code} className={cn(cardVariants(), "gap-2.5 p-3.5")}>
                  <div className="flex items-start gap-2.5">
                    <span className="num pt-0.5 font-semibold">{chapter.code}</span>
                    <Link href={chapterHref(chapter.code)} className="min-w-0 flex-1 leading-snug font-semibold">
                      {chapter.name}
                    </Link>
                    <ChapterStatePill state={chapter.state} />
                  </div>
                  <ChapterNotes chapter={chapter} today={today} />
                  <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-[13px]">
                    <dt className="text-muted-foreground">{t("plan")}</dt>
                    <dd className="num m-0">
                      {plan ?? "—"}
                      {soon !== null && soon >= 0 && soon <= 14 && <span className="text-muted-foreground"> · {t("inDays", { count: soon })}</span>}
                    </dd>
                    {actual && (
                      <>
                        <dt className="text-muted-foreground">{t("actual")}</dt>
                        <dd className="num m-0">{actual}</dd>
                      </>
                    )}
                  </dl>
                  {timeline && chapter.state !== "pending" && <GanttBar chapter={chapter} timeline={timeline} today={today} className="min-w-0" />}
                  {actions && (
                    <div className="flex justify-end">
                      <RowActions chapter={chapter} actions={actions} phone />
                    </div>
                  )}
                </article>
              );
            })}
            {hidden > 0 && (
              <Button type="button" variant="ghost" className="self-start text-brand-ink" onClick={() => onShowState(group.state)}>
                {t("showAll", { count: group.chapters.length, state: tg(`${group.state}Name`) })}
              </Button>
            )}
          </section>
        );
      })}
    </div>
  );
}
