"use client";

// Container for the project's Compras tab by budget line (its default view):
// read-only, it filters and folds chapters and lines open, keeping the filters
// and the chapters open in the URL (`?estado=&capitulo=&q=&abierto=03,07`,
// replaced). The views in ../components/purchasing take props only.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { PURCHASE_PROGRESS, type ProjectPurchaseLines, type PurchaseProgress } from "@repo/core/contract";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { openGroups, openParam, parseOpen, useUrlState } from "../../../components/useUrlState";
import { FilterSelect, FoldAllButtons } from "../components/construction/Filters";
import { StageEyebrow, type ObraHeader } from "../components/construction/ObraFrame";
import Segmented from "../components/construction/Segmented";
import { DueBanner, LineKpis, ViewSwitch } from "../components/purchasing/LineViews";
import { LineTable } from "../components/purchasing/LineTable";
import { rollUpLines } from "../components/purchasing/line-rollup";
import { newOrderHref } from "../components/purchasing/links";

type ProgressFilter = "all" | PurchaseProgress;

/** What the page shows: the lines by state, chapter and text, and the chapters open (null: the default). */
type LinesView = { progress: ProgressFilter; chapter: string; query: string; open: string[] | null };

const parseView = (params: URLSearchParams): LinesView => ({
  progress: PURCHASE_PROGRESS.find((key) => key === params.get("estado")) ?? "all",
  chapter: params.get("capitulo") ?? "",
  query: params.get("q") ?? "",
  open: parseOpen(params.get("abierto")),
});

const viewParams = (view: LinesView) => ({
  estado: view.progress === "all" ? null : view.progress,
  capitulo: view.chapter || null,
  q: view.query.trim() ? view.query : null,
  abierto: openParam(view.open),
});

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
  const [view, setView] = useUrlState(parseView, viewParams);
  const { progress, chapter, query } = view;
  // Lines folded open on their orders: not kept in the URL.
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (lineageId: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (!next.delete(lineageId)) next.add(lineageId);
      return next;
    });

  const needle = query.trim().toLowerCase();
  const filtering = progress !== "all" || needle !== "" || chapter !== "";
  const shown = useMemo(
    () =>
      lines.chapters
        .filter((c) => !chapter || c.code === chapter)
        .map((c) => {
          const kept = c.lines.filter(
            (l) =>
              (progress === "all" || l.progress === progress) &&
              (!needle || l.code.toLowerCase().includes(needle) || l.description.toLowerCase().includes(needle)),
          );
          return { ...c, lines: kept, rollup: rollUpLines(kept) };
        })
        .filter((c) => c.lines.length > 0),
    [lines.chapters, chapter, progress, needle],
  );
  const all = useMemo(() => rollUpLines(lines.chapters.flatMap((c) => c.lines)), [lines.chapters]);

  // Folded by default; a filter, a search or a chapter picked opens what it shows.
  const codes = shown.map((c) => c.code);
  const fallback = filtering ? codes : [];
  const groups = openGroups(view.open, codes, fallback, (open) => setView({ ...view, open }));
  const filter = (change: Partial<Omit<LinesView, "open">>) => setView({ ...view, ...change, open: null });

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
            <span className="text-meta text-muted-foreground">{t("tableHint")}</span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
            <Segmented
              label={t("filter")}
              value={progress}
              onChange={(value) => filter({ progress: value })}
              options={[
                { key: "all" as const, label: t("all"), count: all.lines },
                ...PURCHASE_PROGRESS.map((key) => ({ key, label: tp(key), count: lines.counts[key] })),
              ]}
            />
            <FilterSelect
              id="lines-chapter"
              label={t("chapter")}
              value={chapter}
              onChange={(value) => filter({ chapter: value })}
              options={[
                { value: "", label: t("allChapters") },
                ...lines.chapters.map((c) => ({ value: c.code, label: `${c.code} ${c.name}` })),
              ]}
            />
            <Input
              type="search"
              value={query}
              onChange={(event) => filter({ query: event.target.value })}
              placeholder={t("search")}
              aria-label={t("search")}
              className="h-10 w-full max-w-[240px] bg-card"
            />
            <FoldAllButtons
              className="md:ml-auto"
              allOpen={groups.allOpen}
              noneOpen={groups.noneOpen}
              onExpand={groups.expandAll}
              onCollapse={groups.collapseAll}
            />
          </div>
        </div>
        {all.lines === 0 ? (
          <p className="px-[18px] py-6 text-center text-sm text-muted-foreground">{t("none")}</p>
        ) : (
          <LineTable
            projectId={projectId}
            chapters={shown}
            total={filtering ? undefined : all}
            open={groups.isOpen}
            onToggleChapter={groups.toggle}
            expanded={(id) => expanded.has(id)}
            onToggle={toggle}
            newOrderHref={canManage ? (code) => newOrderHref(projectId, code) : undefined}
          />
        )}
      </section>

      <p className="max-w-[900px] text-meta leading-normal text-muted-foreground">
        {t.rich("footnote", { b: (chunks) => <b className="text-foreground">{chunks}</b> })}
      </p>
    </div>
  );
}
