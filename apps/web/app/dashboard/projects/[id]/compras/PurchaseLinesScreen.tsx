"use client";

// Container for the project's Compras tab by budget line (its default view):
// read-only, it filters and folds lines open. The views in
// ../components/purchasing take props only.

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { PURCHASE_PROGRESS, type ProjectPurchaseLines, type PurchaseProgress } from "@repo/core/contract";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { FilterSelect } from "../components/construction/Filters";
import { StageEyebrow, type ObraHeader } from "../components/construction/ObraFrame";
import Segmented from "../components/construction/Segmented";
import { DueBanner, LineKpis, LineTable, ViewSwitch } from "../components/purchasing/LineViews";
import { newOrderHref } from "../components/purchasing/links";

type ProgressFilter = "all" | PurchaseProgress;

/** The obra's budget lines with what is contracted, invoiced and paid of each (the four states). */
export default function PurchaseLinesScreen({
  projectId,
  header,
  lines,
  canManage,
}: {
  projectId: string;
  header: ObraHeader;
  lines: ProjectPurchaseLines;
  canManage: boolean;
}) {
  const t = useTranslations("purchasing.lines");
  const tp = useTranslations("purchasing.progress");
  const tproject = useTranslations("purchasing.project");
  const [progress, setProgress] = useState<ProgressFilter>("all");
  const [chapter, setChapter] = useState("");
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (lineageId: string) =>
    setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(lineageId)) next.add(lineageId);
      return next;
    });

  const total = lines.chapters.reduce((sum, c) => sum + c.lines.length, 0);
  const shown = lines.chapters
    .filter((c) => !chapter || c.code === chapter)
    .map((c) => ({ ...c, lines: c.lines.filter((l) => progress === "all" || l.progress === progress) }))
    .filter((c) => c.lines.length > 0);

  return (
    <div className="flex flex-col gap-[18px]">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <StageEyebrow label={header.ref} stage={header.stage} />
          <h1 className="mt-1.5">{tproject("title")}</h1>
          <p className="mt-1 max-w-[640px] text-[14px] text-muted-foreground">{t("description")}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2.5 sm:w-auto">
          <ViewSwitch projectId={projectId} view="lines" />
          {canManage && (
            <Link href={newOrderHref(projectId)} className={cn(buttonVariants(), "w-full sm:w-auto")}>
              <Plus aria-hidden />
              {tproject("new")}
            </Link>
          )}
        </div>
      </header>

      <DueBanner invoices={lines.dueAlerts} />
      <LineKpis summary={lines.summary} />

      <section className={cn(cardVariants({ size: "flush" }), "pt-4 pb-1.5")} aria-labelledby="lines-title">
        <div className="flex flex-col gap-3 px-[18px] pb-3.5">
          <div className="flex flex-wrap items-baseline justify-between gap-2.5">
            <h2 id="lines-title" className="text-[22px]">
              {t("tableTitle")}
            </h2>
            <span className="text-[12.5px] text-muted-foreground">{t("tableHint")}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
            <Segmented
              label={t("filter")}
              value={progress}
              onChange={setProgress}
              options={[
                { key: "all" as const, label: t("all"), count: total },
                ...PURCHASE_PROGRESS.map((key) => ({ key, label: tp(key), count: lines.counts[key] })),
              ]}
            />
            <FilterSelect
              id="lines-chapter"
              label={t("chapter")}
              value={chapter}
              onChange={setChapter}
              options={[
                { value: "", label: t("allChapters") },
                ...lines.chapters.map((c) => ({ value: c.code, label: `${c.code} ${c.name}` })),
              ]}
            />
          </div>
        </div>
        {total === 0 ? (
          <p className="px-[18px] py-6 text-center text-[13.5px] text-muted-foreground">{t("none")}</p>
        ) : (
          <LineTable
            projectId={projectId}
            chapters={shown}
            summary={progress === "all" && !chapter ? lines.summary : undefined}
            expanded={(id) => open.has(id)}
            onToggle={toggle}
            newOrderHref={canManage ? (code) => newOrderHref(projectId, code) : undefined}
          />
        )}
      </section>

      <p className="max-w-[900px] text-[12.5px] leading-normal text-muted-foreground">
        {t.rich("footnote", { b: (chunks) => <b className="text-foreground">{chunks}</b> })}
      </p>
    </div>
  );
}
