"use client";

import { useTranslations } from "next-intl";
import type { ProgressEvent } from "@repo/core/contract";
import { cardVariants } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useControlFormat } from "./format";

// Presentational: the record of every start, finish and correction of a
// chapter's dates (with the value before, who and when).

const isCorrection = (event: ProgressEvent) => event.kind === "correct_start" || event.kind === "correct_finish";

/** Avance's "Últimos registros": the latest recorded dates across chapters. */
export function RecentEvents({ events }: { events: ProgressEvent[] }) {
  const t = useTranslations("construction.history");
  const f = useControlFormat();
  return (
    <section className={cn(cardVariants(), "gap-2.5")} aria-labelledby="recent-events">
      <h2 id="recent-events">{t("recentTitle")}</h2>
      {events.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {events.map((event) => (
            <li key={event.id} className="flex flex-col gap-0.5 border-t py-2.5 text-[13px] first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span>
                  <b>{t(`kind.${event.kind}`, { code: event.chapterCode })}</b> ·{" "}
                  <span className="num">
                    {isCorrection(event)
                      ? `${event.previousDate ? f.day(event.previousDate) : "—"} → ${event.newDate ? f.day(event.newDate) : "—"}`
                      : event.newDate && f.fullDay(event.newDate)}
                  </span>
                </span>
                <span className="num text-muted-foreground">{f.stamp(event.recordedAt)}</span>
              </div>
              <span className="text-muted-foreground">
                {[
                  event.recordedBy,
                  isCorrection(event)
                    ? event.note && `«${event.note}»`
                    : t(event.kind === "start" ? "becameInProgress" : "becameFinished", { code: event.chapterCode }),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** A chapter's page: its whole history. */
export function HistoryTable({ events }: { events: ProgressEvent[] }) {
  const t = useTranslations("construction.history");
  const f = useControlFormat();
  return (
    <section className={cn(cardVariants({ size: "flush" }), "pt-[18px] pb-1.5")} aria-labelledby="history-title">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-[18px] pb-3">
        <h2 id="history-title">{t("title")}</h2>
        <span className="text-[12.5px] text-muted-foreground">{t("hint")}</span>
      </div>
      {events.length === 0 ? (
        <p className="px-[18px] pb-4 text-[13px] text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table className="min-w-[720px] text-[13px]" aria-labelledby="history-title">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-[18px]">{t("record")}</TableHead>
              <TableHead>{t("before")}</TableHead>
              <TableHead>{t("after")}</TableHead>
              <TableHead>{t("recorded")}</TableHead>
              <TableHead className="pr-[18px]">{t("by")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((event) => (
              <TableRow key={event.id}>
                <TableCell className="pl-[18px] whitespace-normal">
                  <b>{t(`row.${event.kind}`)}</b>
                  <div className="text-muted-foreground">
                    {isCorrection(event)
                      ? event.note && `«${event.note}»`
                      : t(event.kind === "start" ? "pendingToInProgress" : "inProgressToFinished")}
                  </div>
                </TableCell>
                <TableCell className="num">{event.previousDate ? f.fullDay(event.previousDate) : <Muted />}</TableCell>
                <TableCell className="num">{event.newDate ? f.fullDay(event.newDate) : <Muted text={t("cleared")} />}</TableCell>
                <TableCell className="num text-muted-foreground">{f.stamp(event.recordedAt)}</TableCell>
                <TableCell className="pr-[18px]">{event.recordedBy ?? <Muted />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

const Muted = ({ text = "—" }: { text?: string }) => <span className="text-muted-foreground">{text}</span>;
