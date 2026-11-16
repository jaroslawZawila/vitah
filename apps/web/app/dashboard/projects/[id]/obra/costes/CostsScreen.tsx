"use client";

// Container for Obra › Costes: read-only, it filters and folds chapters open,
// keeping both in the URL (`?capitulo=&estado=&q=&abierto=03,07`, replaced).
// The views in ../../components/construction take props only.

import Link from "next/link";
import { useMemo } from "react";
import { useTranslations } from "next-intl";
import type { ConstructionCosts, CostLine } from "@repo/core/contract";
import { Input } from "@/components/ui/input";
import { openGroups, openParam, parseOpen, useUrlState } from "../../../../components/useUrlState";
import { footnote, moreLink } from "../../components/construction/classes";
import { rollUpCosts } from "../../components/construction/cost-rollup";
import CostCards from "../../components/construction/CostCards";
import CostTable from "../../components/construction/CostTable";
import { FilterSelect, FoldAllButtons } from "../../components/construction/Filters";
import ObraFrame, { obraHref, type ObraHeader } from "../../components/construction/ObraFrame";
import LateDeliveriesBanner from "../../components/construction/LateDeliveriesBanner";
import { LiveBadge, Source, SourceLabel } from "../../components/construction/pills";
import { newOrderHref, orderHref } from "../../components/purchasing/links";
import Segmented from "../../components/construction/Segmented";

const CONTRACTING = ["all", "closed", "open", "uncontracted", "overrun"] as const;
type Contracting = (typeof CONTRACTING)[number];

const MATCHES: Record<Contracting, (line: CostLine) => boolean> = {
  all: () => true,
  closed: (line) => line.contracting === "closed",
  open: (line) => line.contracting === "open",
  uncontracted: (line) => line.contracting === "none",
  overrun: (line) => (line.deviationCents ?? 0) > 0,
};

/** What the page shows: the chapter picked, the lines by contracting and text, and the chapters open (null: the default). */
type CostsView = { chapter: string; contracting: Contracting; query: string; open: string[] | null };

const parseView = (params: URLSearchParams): CostsView => ({
  chapter: params.get("capitulo") || "all",
  contracting: CONTRACTING.find((key) => key === params.get("estado")) ?? "all",
  query: params.get("q") ?? "",
  open: parseOpen(params.get("abierto")),
});

const viewParams = (view: CostsView) => ({
  capitulo: view.chapter === "all" ? null : view.chapter,
  estado: view.contracting === "all" ? null : view.contracting,
  q: view.query.trim() ? view.query : null,
  abierto: openParam(view.open),
});

/** What each budget line was expected to cost against what was contracted. */
export default function CostsScreen({
  projectId,
  header,
  costs,
  budgetNumber,
  canManage,
}: {
  projectId: string;
  header: ObraHeader;
  costs: ConstructionCosts;
  budgetNumber: number | null;
  canManage: boolean;
}) {
  const t = useTranslations("construction.costs");
  const tf = useTranslations("construction.filters");
  const ts = useTranslations("construction.sources");
  const [view, setView] = useUrlState(parseView, viewParams);
  const { chapter, contracting, query } = view;
  const needle = query.trim().toLowerCase();
  const filtering = contracting !== "all" || needle !== "";

  const shown = useMemo(
    () =>
      costs.chapters
        .filter((c) => chapter === "all" || c.code === chapter)
        .map((c) => {
          const lines = c.lines.filter(
            (line) =>
              MATCHES[contracting](line) &&
              (!needle || line.description.toLowerCase().includes(needle) || line.code.toLowerCase().includes(needle)),
          );
          return { ...c, lines, rollup: rollUpCosts(lines) };
        })
        .filter((c) => !filtering || c.lines.length > 0),
    [costs.chapters, chapter, contracting, needle, filtering],
  );
  // The obra's totals and how many lines each filter keeps: the whole obra, whatever is shown.
  const { total, counts } = useMemo(() => {
    const lines = costs.chapters.flatMap((c) => c.lines);
    return {
      total: rollUpCosts(lines),
      counts: Object.fromEntries(CONTRACTING.map((key) => [key, lines.filter(MATCHES[key]).length])) as Record<Contracting, number>,
    };
  }, [costs.chapters]);

  // Folded by default; a filter, a search or a chapter picked opens what it shows.
  const codes = shown.map((c) => c.code);
  const fallback = filtering || chapter !== "all" ? codes : [];
  const groups = openGroups(view.open, codes, fallback, (open) => setView({ ...view, open }));
  const filter = (change: Partial<Omit<CostsView, "open">>) => setView({ ...view, ...change, open: null });
  // The table from 768px, the cards below it: the same chapters, folds and links.
  const tableProps = {
    chapters: shown,
    total: filtering || chapter !== "all" ? undefined : total,
    expanded: groups.isOpen,
    onToggle: groups.toggle,
    orderHref: (id: string) => orderHref(projectId, id),
    newOrderHref: canManage ? (code: string) => newOrderHref(projectId, code) : undefined,
  };

  return (
    <ObraFrame
      projectId={projectId}
      header={header}
      current="costs"
      title={t("title")}
      description={t("description")}
      aside={
        <div className="flex flex-col gap-1">
          <SourceLabel>
            {t("costFrom")} <Source name={budgetNumber !== null ? t("budgetRevision", { number: budgetNumber }) : ts("budget")} />{" "}
            {t("atCost")}
          </SourceLabel>
          <SourceLabel>
            {t("contractedFrom")} <Source name={ts("purchasing")} />
            <LiveBadge />
          </SourceLabel>
        </div>
      }
    >
      <LateDeliveriesBanner orders={costs.lateDeliveries} orderHref={(id) => orderHref(projectId, id)} />

      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5">
        <FilterSelect
          id="costs-chapter"
          label={tf("chapter")}
          value={chapter}
          onChange={(value) => filter({ chapter: value })}
          options={[{ value: "all", label: tf("all") }, ...costs.chapters.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))]}
        />
        {/* On a phone the five options don't fit a row: a select, as the project list does. */}
        <FilterSelect
          id="costs-contracting"
          label={t("contracting")}
          value={contracting}
          onChange={(value) => filter({ contracting: CONTRACTING.find((key) => key === value) ?? "all" })}
          options={CONTRACTING.map((key) => ({ value: key, label: `${t(`filter.${key}`)} · ${counts[key]}` }))}
          className="sm:hidden"
        />
        <Segmented
          label={t("contracting")}
          value={contracting}
          onChange={(value) => filter({ contracting: value })}
          options={CONTRACTING.map((key) => ({ key, label: t(`filter.${key}`), count: counts[key] }))}
          className="hidden sm:inline-flex"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => filter({ query: event.target.value })}
          placeholder={t("search")}
          aria-label={t("search")}
          className="h-10 w-full bg-card sm:max-w-[240px]"
        />
        <FoldAllButtons
          allOpen={groups.allOpen}
          noneOpen={groups.noneOpen}
          onExpand={groups.expandAll}
          onCollapse={groups.collapseAll}
        />
        <Link href={obraHref(projectId)} className={`${moreLink} md:ml-auto`}>
          {t("totalsInSummary")} →
        </Link>
      </div>

      <CostTable {...tableProps} />
      <CostCards {...tableProps} className="md:hidden" />

      <p className={footnote}>{t("footnote")}</p>
    </ObraFrame>
  );
}
