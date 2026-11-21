"use client";

import { useTranslations } from "next-intl";
import { projectSchedule, type ScheduleStatus } from "@repo/core/contract";
import { cn } from "@/lib/utils";
import { kpiFigure } from "./classes";
import { useControlFormat } from "./format";
import { STATUS_TONE, TONE_TEXT } from "./schedule";

/**
 * Presentational: whether the obra is on time, as core's `scheduleStatus`
 * decides (the same on Resumen and Planificación): the headline, the worst
 * fact with its figures, and how many chapters are late to start or finish.
 */
export default function ScheduleStatusView({ schedule }: { schedule: ScheduleStatus }) {
  const t = useTranslations("construction.scheduleStatus");
  const f = useControlFormat();
  const { status, forecast, lateToStart, lateToFinish, worst } = schedule;
  const [start] = lateToStart;
  const [finish] = lateToFinish;
  const forecastDelay = forecast?.delayDays ?? null;

  let headline: string;
  let caption: string;
  if (status === "late") {
    headline = f.signedDays(projectSchedule(schedule).days!);
    caption = t(`worst.${worst!}`);
  } else {
    headline = t(`headline.${status}`);
    caption = t(`caption.${status}`);
  }

  const lines: { text: string; tone?: string }[] = [];
  if (status === "simulated" || status === "no_dates") lines.push({ text: t(`text.${status}`) });
  if (forecast) {
    if (forecastDelay !== null && forecastDelay > 0) {
      lines.push({
        text: t("forecastLate", { date: f.date(forecast.endDate), contract: f.date(forecast.contractEnd!), count: forecastDelay }),
      });
    } else if (forecast.contractEnd) {
      lines.push({ text: t("forecastWithin", { date: f.date(forecast.endDate), contract: f.date(forecast.contractEnd) }) });
    } else {
      lines.push({ text: t("forecastNoContract", { date: f.date(forecast.endDate) }) });
    }
  }
  if (status === "late" || status === "simulated") {
    if (status === "simulated" && (finish || start)) lines.push({ text: t("bySimulated"), tone: "text-muted-foreground" });
    if (finish) {
      lines.push({ text: t("lateToFinish", { count: lateToFinish.length, code: finish.code, name: finish.name, date: f.date(finish.plannedDate) }) });
    }
    if (start) {
      lines.push({ text: t("lateToStart", { count: lateToStart.length, code: start.code, name: start.name, date: f.date(start.plannedDate) }) });
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className={cn(kpiFigure, TONE_TEXT[STATUS_TONE[status]])}>{headline}</span>
        <span className="text-muted-foreground">{caption}</span>
      </div>
      {lines.map((line) => (
        <p key={line.text} className={cn("text-sm leading-snug", line.tone)}>
          {line.text}
        </p>
      ))}
    </>
  );
}
