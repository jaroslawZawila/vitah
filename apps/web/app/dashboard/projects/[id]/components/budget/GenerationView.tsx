"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BudgetGeneration } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { muted } from "../obra/classes";
import { useObraFormat } from "../obra/format";
import ProgressBar from "../obra/ProgressBar";

/** The pipeline's six jobs, in order, by the step that runs them. */
const JOBS = [
  { key: "read", step: 0 },
  { key: "analysed", step: 1 },
  { key: "group0", step: 2 },
  { key: "group1", step: 3 },
  { key: "group2", step: 4 },
  { key: "group3", step: 5 },
] as const;

/** Presentational: the AI drafting the budget: its steps, what it has read so far, and Cancel. */
export default function GenerationView({
  generation,
  pending,
  onCancel,
}: {
  generation: BudgetGeneration;
  pending: boolean;
  onCancel?: () => void;
}) {
  const t = useTranslations("budget.generation");
  const f = useObraFormat();
  const done = (step: number) => generation.log.some((l) => l.step === step && l.kind === "done");
  const detail = (step: number) => generation.log.find((l) => l.step === step && l.kind === "done")?.params ?? {};
  const doneCount = JOBS.filter((job) => done(job.step)).length;
  const current = JOBS.find((job) => !done(job.step));
  const { facts } = generation;

  return (
    <div className="flex flex-col gap-4.5 lg:flex-row lg:items-start">
      <section className={cn(cardVariants(), "min-w-0 flex-1")} aria-labelledby="generation-title" aria-live="polite">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="eyebrow">{t("step", { step: Math.min(doneCount + 1, JOBS.length), total: JOBS.length })}</p>
            <h2 id="generation-title">{t("title")}</h2>
          </div>
          <span className="num text-sm text-muted-foreground">{t("pct", { pct: Math.round((doneCount * 100) / JOBS.length) })}</span>
        </div>
        <ProgressBar pct={(doneCount * 100) / JOBS.length} className="h-2.5 flex-none" />
        <ol>
          {JOBS.map((job) => {
            const state = done(job.step) ? "done" : job === current ? "run" : "todo";
            const params = detail(job.step);
            return (
              <li key={job.key} className="flex items-start gap-3 border-b py-3">
                <span
                  className={cn(
                    "flex size-[26px] flex-none items-center justify-center rounded-full text-xs font-bold",
                    state === "done" && "bg-good-soft text-good",
                    state === "run" && "bg-primary text-primary-foreground ring-4 ring-brand-soft",
                    state === "todo" && "bg-raise text-muted-foreground",
                  )}
                >
                  {state === "done" ? <Check size={14} aria-hidden /> : job.step + 1}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14.5px] font-semibold">{t(`jobs.${job.key}.title`)}</div>
                  <div className={muted}>
                    {state === "done"
                      ? t(`jobs.${job.key}.done`, {
                          files: Number(params.files ?? 0),
                          builtArea: f.quantity(Number(params.builtArea ?? 0)),
                          inconsistencies: Number(params.inconsistencies ?? 0),
                          lines: Number(params.lines ?? 0),
                        })
                      : t(`jobs.${job.key}.todo`)}
                  </div>
                </div>
                {state === "done" && params.amountCents !== undefined && <span className="num text-[13px] text-muted-foreground">{f.money(Number(params.amountCents))}</span>}
              </li>
            );
          })}
        </ol>
        <div className="flex flex-wrap items-center justify-between gap-2.5">
          <p className={muted}>{t("leave")}</p>
          {onCancel && (
            <Button type="button" variant="ghost" disabled={pending} onClick={onCancel}>{t("cancel")}</Button>
          )}
        </div>
      </section>

      <aside className="flex flex-col gap-4.5 lg:w-[340px] lg:flex-none">
        <section className={cardVariants()}>
          <span className="eyebrow">{t("facts")}</span>
          {facts ? (
            <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-3.5 gap-y-1.5 text-sm">
              {([
                ["promoter", facts.promoter],
                ["site", facts.site],
                ["architect", facts.architect],
                ["typology", facts.typology],
                ["surfaces", t("surfacesValue", { built: f.quantity(facts.builtAreaM2), useful: f.quantity(facts.usefulAreaM2) })],
                ["counts", t("countsValue", { windows: facts.windows, bathrooms: facts.bathrooms, bedrooms: facts.bedrooms })],
              ] as const).map(([key, value]) => (
                <div key={key} className="contents">
                  <dt className="text-muted-foreground">{t(`factLabels.${key}`)}</dt>
                  <dd className="font-medium">{value || "—"}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <p className={muted}>{t("factsPending")}</p>
          )}
        </section>
        {facts && facts.inconsistencies.length > 0 && (
          <section className={cardVariants()}>
            <div className="flex items-center justify-between">
              <span className="eyebrow">{t("inconsistencies")}</span>
              <Badge variant="warn">{facts.inconsistencies.length}</Badge>
            </div>
            <ul className="flex flex-col gap-1.5 text-[13.5px]">
              {facts.inconsistencies.slice(0, 3).map((item) => <li key={item}>{item}</li>)}
            </ul>
            <p className={muted}>{t("inconsistenciesHint")}</p>
          </section>
        )}
      </aside>
    </div>
  );
}
