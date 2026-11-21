"use client";

import { useTranslations } from "next-intl";
import type { ProgressEvent } from "@repo/core/contract";
import { cardVariants } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useControlFormat } from "./format";
import { Figure } from "./SummaryTable";

// Presentational: the record of every start, finish and correction of a
// chapter's dates (with the value before, who and when).

const isCorrection = (event: ProgressEvent) => event.kind === "correct_start" || event.kind === "correct_finish";

/** A chapter's page: its whole history. */
export function HistoryTable({ events }: { events: ProgressEvent[] }) {
  const t = useTranslations("construction.history");
  const f = useControlFormat();
  return (
    <section className={cn(cardVariants({ size: "flush" }), "pt-[18px] pb-1.5")} aria-labelledby="history-title">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-[18px] pb-3">
        <h2 id="history-title">{t("title")}</h2>
        <span className="text-meta text-muted-foreground">{t("hint")}</span>
      </div>
      {events.length === 0 ? (
        <p className="px-[18px] pb-4 text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <Table className="hidden min-w-[720px] md:table" aria-labelledby="history-title">
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
                <TableCell className="num">{event.previousDate ? f.date(event.previousDate) : <Muted />}</TableCell>
                <TableCell className="num">{event.newDate ? f.date(event.newDate) : <Muted text={t("cleared")} />}</TableCell>
                <TableCell className="num text-muted-foreground">{f.dateTime(event.recordedAt)}</TableCell>
                <TableCell className="pr-[18px]">{event.recordedBy ?? <Muted />}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {/* Below 768px the table as a list: each record with its dates before and now, then when and by whom. */}
      {events.length > 0 && (
        <ul className="m-0 list-none p-0 md:hidden" aria-labelledby="history-title">
          {events.map((event) => (
            <li key={event.id} className="flex flex-col gap-1.5 border-t px-[18px] py-3 text-sm">
              <div>
                <b>{t(`row.${event.kind}`)}</b>
                <div className="text-muted-foreground">
                  {isCorrection(event)
                    ? event.note && `«${event.note}»`
                    : t(event.kind === "start" ? "pendingToInProgress" : "inProgressToFinished")}
                </div>
              </div>
              <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-1.5">
                <Figure label={t("before")}>{event.previousDate ? <span className="num">{f.date(event.previousDate)}</span> : <Muted />}</Figure>
                <Figure label={t("after")}>{event.newDate ? <span className="num">{f.date(event.newDate)}</span> : <Muted text={t("cleared")} />}</Figure>
              </dl>
              <p className="text-meta text-muted-foreground">
                {t.rich(event.recordedBy ? "recordedOnBy" : "recordedOn", {
                  date: f.dateTime(event.recordedAt),
                  by: event.recordedBy ?? "",
                  num: (chunks) => <span className="num">{chunks}</span>,
                })}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const Muted = ({ text = "—" }: { text?: string }) => <span className="text-muted-foreground">{text}</span>;
