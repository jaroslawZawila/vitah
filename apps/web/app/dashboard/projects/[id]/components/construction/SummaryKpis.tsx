"use client";

import { useTranslations } from "next-intl";
import type { ConstructionControl } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { kv } from "./classes";
import { deviationTone, useControlFormat } from "./format";
import { Source, SourceLabel } from "./pills";

const figure = "font-heading text-[40px] leading-none font-semibold tabular-nums";

/** Presentational: the Resumen's four key figures: chapters, cost, sales and schedule. */
export default function SummaryKpis({ control }: { control: ConstructionControl }) {
  const t = useTranslations("construction.summary.kpis");
  const ts = useTranslations("construction.sources");
  const f = useControlFormat();
  const { chapters, cost, sales, sources, budget, project } = control;
  const count = (state: string) => chapters.filter((c) => c.state === state).length;
  const finished = count("finished");
  const inProgress = count("in_progress");
  const pending = count("pending");
  const share = (n: number) => `${chapters.length ? (n / chapters.length) * 100 : 0}%`;

  // The worst delay of what is in progress now.
  const overdue = chapters
    .filter((c) => c.state === "in_progress" && (c.overdueDays ?? 0) > 0)
    .sort((a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0))[0];
  const late = chapters.filter((c) => c.state === "finished" && (c.endDelayDays ?? 0) > 0);
  const averageLate = late.length ? Math.round(late.reduce((sum, c) => sum + c.endDelayDays!, 0) / late.length) : 0;
  const firstStart = chapters
    .map((c) => c.actualStart)
    .filter((d): d is string => !!d)
    .sort()[0];
  const revision = budget ? t("revision", { number: budget.number }) : "";

  return (
    <section aria-label={t("label")} className="grid grid-cols-[repeat(auto-fit,minmax(min(250px,100%),1fr))] gap-3.5">
      <div className={cn(cardVariants(), "gap-2.5")}>
        <span className="eyebrow">{t("chapters")}</span>
        <div className="flex items-baseline gap-2">
          <span className={figure}>{finished}</span>
          <span className="text-muted-foreground">{t("finishedOf", { total: chapters.length })}</span>
        </div>
        <div
          role="img"
          aria-label={t("chaptersBar", { finished, inProgress, pending })}
          className="flex h-2 overflow-hidden rounded-full bg-raise"
        >
          <span className="bg-good" style={{ width: share(finished) }} />
          <span className="bg-primary/55" style={{ width: share(inProgress) }} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="good">{t("finishedCount", { count: finished })}</Badge>
          <Badge>{t("inProgressCount", { count: inProgress })}</Badge>
          <Badge variant="outline">{t("pendingCount", { count: pending })}</Badge>
        </div>
      </div>

      <div className={cn(cardVariants(), "gap-1.5")}>
        <span className="eyebrow">{t("cost")}</span>
        <div className={kv}>
          <span className="text-muted-foreground">{t("budgeted")}</span>
          <span className="num">{f.moneyRound(cost.budgetedCents)}</span>
        </div>
        <div className={kv}>
          <span className="text-muted-foreground">{t("contracted")}</span>
          <span className="num">{f.moneyRound(cost.contractedCents)}</span>
        </div>
        <div className={kv}>
          <span className="font-semibold">{t("deviation")}</span>
          <span className={cn("num font-semibold", deviationTone(cost.deviationCents))}>
            {cost.contractedCostCents
              ? `${f.signedEuros(cost.deviationCents)} € · ${f.signedPct(cost.deviationBp, 2)}`
              : "—"}
          </span>
        </div>
        <p className="mt-0.5 text-[12px] leading-snug text-muted-foreground">
          {cost.contractedCostCents
            ? t(cost.deviationCents > 0 ? "overrunNote" : "savingNote", { amount: f.moneyRound(cost.contractedCostCents) })
            : t("nothingContracted")}
        </p>
        <SourceLabel>
          {ts("budget")} {revision} · <Source name={ts("purchasing")} />
        </SourceLabel>
      </div>

      <div className={cn(cardVariants(), "gap-1.5")}>
        <span className="eyebrow">{t("sales")}</span>
        <div className={kv}>
          <span className="text-muted-foreground">{t("contract")}</span>
          <span className="num">{f.money(sales.contractCents)}</span>
        </div>
        <div className={kv}>
          <span className="text-muted-foreground">{t("invoiced")}</span>
          <span className="num">{f.money(sales.invoicedCents)}</span>
        </div>
        <div className={kv}>
          <span className="text-muted-foreground">{t("collected")}</span>
          <span className="num text-good">{f.money(sales.collectedCents)}</span>
        </div>
        <div className={kv}>
          <span className="font-semibold">{t("outstanding")}</span>
          <span className={cn("num font-semibold", sales.outstandingCents > 0 && "text-warn")}>{f.money(sales.outstandingCents)}</span>
        </div>
        <div className={kv}>
          <span className="text-muted-foreground">{t("toInvoice")}</span>
          <span className="num">{f.money(sales.toInvoiceCents)}</span>
        </div>
        <SourceLabel>
          {ts("payments")} · <Source name={ts("sales")} />
        </SourceLabel>
      </div>

      <div className={cn(cardVariants(), "gap-1.5")}>
        <span className="eyebrow">{t("schedule")}</span>
        <div className="flex items-baseline gap-2">
          <span className={cn(figure, overdue ? "text-warn" : "text-good")}>
            {overdue ? f.signedDays(overdue.overdueDays!) : t("onTime")}
          </span>
          <span className="text-muted-foreground">{overdue ? t("worstDelay") : t("noDelay")}</span>
        </div>
        {overdue?.plannedEnd && (
          <p className="text-[13px]">
            {t("overdueText", { code: overdue.code, name: overdue.name, date: f.day(overdue.plannedEnd) })}
          </p>
        )}
        <div className={kv}>
          <span className="text-muted-foreground">{t("worksStart")}</span>
          <span className="num">
            {project.startDate ? f.day(project.startDate) : "—"}
            {firstStart && ` · ${t("actualShort", { date: f.day(firstStart) })}`}
          </span>
        </div>
        <div className={kv}>
          <span className="text-muted-foreground">{t("finishedLate")}</span>
          <span className="num">
            {t("lateCount", { late: late.length, total: finished })}
            {late.length > 0 && ` · ${t("averageLate", { days: f.signedDays(averageLate) })}`}
          </span>
        </div>
        <SourceLabel>
          <Source name={ts("planning")} mock={sources.planning === "mock"} /> · <Source name={ts("progress")} />
        </SourceLabel>
      </div>
    </section>
  );
}
