"use client";

import Link from "next/link";
import { Fragment } from "react";
import { useTranslations } from "next-intl";
import type { ConstructionControl, ControlChapter } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { cardTop, footnote, groupRow, moreLink, totalRow } from "./classes";
import { deviationTone, useControlFormat, type ControlFormat } from "./format";
import { ChapterStatePill, SCHEDULE_TONE, Source, SourceLabel } from "./pills";
import { groupByState, scheduleOf } from "./schedule";

/** "14/09 – 09/10", "21/09 – …" or "—". */
export function dateSpan(f: ControlFormat, start: string | null, end: string | null) {
  if (!start && !end) return null;
  return `${start ? f.day(start) : "…"} – ${end ? f.day(end) : "…"}`;
}

/** Presentational: a chapter's schedule against its plan, as a pill (or a muted note). */
export function SchedulePill({ chapter, today, long = false }: { chapter: ControlChapter; today: string; long?: boolean }) {
  const t = useTranslations("construction.schedule");
  const f = useControlFormat();
  const schedule = scheduleOf(chapter, today);
  if (!schedule) return null;
  const label = t(long && schedule.key === "overdue" ? "overdueLong" : schedule.key, {
    days: f.signedDays(schedule.days),
    count: schedule.days,
  });
  if (schedule.key === "startsIn") return <span className="text-[12.5px] text-muted-foreground">{label}</span>;
  return <Badge variant={SCHEDULE_TONE[schedule.tone]}>{label}</Badge>;
}

/** Presentational: the deviation of what was contracted, "+440 · +1,4 %", or "—". */
export function Deviation({ cents, bp }: { cents: number | null; bp: number | null }) {
  const f = useControlFormat();
  if (cents === null) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("num", deviationTone(cents))}>
      {f.signedEuros(cents)}
      {bp !== null && ` · ${f.signedPct(bp)}`}
    </span>
  );
}

/**
 * Presentational: the Resumen's chapters, grouped by state (now, next,
 * done), with plan vs actual dates, cost and contract deviation.
 */
export default function SummaryTable({
  chapters,
  control,
  chapterHref,
  progressHref,
}: {
  /** The chapters to show (already filtered). */
  chapters: ControlChapter[];
  control: ConstructionControl;
  chapterHref: (code: string) => string;
  progressHref: string;
}) {
  const t = useTranslations("construction.summary.table");
  const ts = useTranslations("construction.sources");
  const tg = useTranslations("construction.groups");
  const f = useControlFormat();
  const { today, sources, cost } = control;

  const totals = chapters.reduce(
    (sum, c) => ({
      cost: sum.cost + c.costCents,
      contracted: sum.contracted + (c.contractedCents ?? 0),
      contractedCost: sum.contractedCost + c.contractedCostCents,
      deviation: sum.deviation + (c.deviationCents ?? 0),
    }),
    { cost: 0, contracted: 0, contractedCost: 0, deviation: 0 },
  );

  return (
    <section className={cn(cardVariants({ size: "flush" }), "pt-[18px] pb-1.5")} aria-labelledby="chapters-title">
      <div className={cn(cardTop, "px-[18px] pb-3")}>
        <h2 id="chapters-title" className="text-2xl">
          {t("title")}
        </h2>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-1">
          <SourceLabel>
            {t("planDates")} <Source name={ts("planning")} mock={sources.planning === "mock"} />
          </SourceLabel>
          <SourceLabel>
            {t("actualDates")} <Source name={ts("progress")} />
          </SourceLabel>
          <SourceLabel>
            {t("contractedFrom")} <Source name={ts("purchasing")} mock={sources.purchasing === "mock"} />
          </SourceLabel>
          <Link href={progressHref} className={moreLink}>
            {t("recordProgress")} →
          </Link>
        </div>
      </div>
      {chapters.length === 0 ? (
        <p className="px-[18px] py-6 text-center text-[13.5px] text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table className="min-w-[1080px] text-[13px]" aria-labelledby="chapters-title">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-[18px]">{t("code")}</TableHead>
              <TableHead>{t("chapter")}</TableHead>
              <TableHead>{t("state")}</TableHead>
              <TableHead>{t("plan")}</TableHead>
              <TableHead>{t("actual")}</TableHead>
              <TableHead>{t("schedule")}</TableHead>
              <TableHead>{t("hito")}</TableHead>
              <TableHead className="text-right">{t("cost")}</TableHead>
              <TableHead className="text-right">{t("contracted")}</TableHead>
              <TableHead className="pr-[18px] text-right">{t("deviation")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {groupByState(chapters).map((group) => (
              <Fragment key={group.state}>
                <TableRow className={groupRow}>
                  <TableCell colSpan={10} className="pl-[18px]">
                    {tg(group.state, { count: group.chapters.length })}
                  </TableCell>
                </TableRow>
                {group.chapters.map((chapter) => (
                  <TableRow key={chapter.code}>
                    <TableCell className="num pl-[18px]">{chapter.code}</TableCell>
                    <TableCell className="min-w-[220px] whitespace-normal">
                      <Link href={chapterHref(chapter.code)} className="font-semibold transition-colors hover:text-primary">
                        {chapter.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <ChapterStatePill state={chapter.state} />
                    </TableCell>
                    <TableCell className="num">{dateSpan(f, chapter.plannedStart, chapter.plannedEnd) ?? <Dash />}</TableCell>
                    <TableCell className="num">{dateSpan(f, chapter.actualStart, chapter.actualEnd) ?? <Dash />}</TableCell>
                    <TableCell>
                      <SchedulePill chapter={chapter} today={today} />
                    </TableCell>
                    <TableCell className="num">{chapter.hitoCode ?? <Dash />}</TableCell>
                    <TableCell className="num text-right">{f.euros(chapter.costCents)}</TableCell>
                    <TableCell className="text-right">
                      {chapter.contractedCents === null ? (
                        <Dash />
                      ) : (
                        <span className="num">
                          {f.euros(chapter.contractedCents)}
                          {chapter.contractedLines < chapter.lineCount && (
                            <span className="text-muted-foreground" title={t("contractedLines", { contracted: chapter.contractedLines, total: chapter.lineCount })}>
                              {" "}
                              {chapter.contractedLines}/{chapter.lineCount}
                            </span>
                          )}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="pr-[18px] text-right">
                      <Deviation cents={chapter.deviationCents} bp={chapter.deviationBp} />
                    </TableCell>
                  </TableRow>
                ))}
              </Fragment>
            ))}
            <TableRow className={totalRow}>
              <TableCell className="pl-[18px]" />
              <TableCell colSpan={6}>{t("total", { count: chapters.length })}</TableCell>
              <TableCell className="num text-right">{f.euros(totals.cost)}</TableCell>
              <TableCell className="num text-right">{f.euros(totals.contracted)}</TableCell>
              <TableCell className="pr-[18px] text-right">
                {totals.contractedCost ? (
                  <Deviation cents={totals.deviation} bp={Math.round((totals.deviation * 10_000) / totals.contractedCost)} />
                ) : (
                  <Dash />
                )}
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
      <p className={cn(footnote, "px-[18px] pt-2.5 pb-3")}>
        {t("footnote", { contingency: f.euros(cost.contingencyCents) })}
      </p>
    </section>
  );
}

export const Dash = () => <span className="text-muted-foreground">—</span>;
