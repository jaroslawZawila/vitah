"use client";

// Container for Obra › Costes: read-only, it only filters. The views in
// ../../components/construction take props only.

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ConstructionCosts, CostLine } from "@repo/core/contract";
import { Input } from "@/components/ui/input";
import { footnote, moreLink } from "../../components/construction/classes";
import CostTable from "../../components/construction/CostTable";
import { FilterSelect } from "../../components/construction/Filters";
import ObraFrame, { obraHref, type ObraHeader } from "../../components/construction/ObraFrame";
import LateDeliveriesBanner from "../../components/construction/LateDeliveriesBanner";
import { LiveBadge, Source, SourceLabel } from "../../components/construction/pills";
import { newOrderHref, orderHref } from "../../components/purchasing/links";
import Segmented from "../../components/construction/Segmented";

type Contracting = "all" | "closed" | "open" | "uncontracted" | "overrun";

const MATCHES: Record<Contracting, (line: CostLine) => boolean> = {
  all: () => true,
  closed: (line) => line.contracting === "closed",
  open: (line) => line.contracting === "open",
  uncontracted: (line) => line.contracting === "none",
  overrun: (line) => (line.deviationCents ?? 0) < 0,
};

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
  const [chapter, setChapter] = useState("all");
  const [contracting, setContracting] = useState<Contracting>("all");
  const [query, setQuery] = useState("");
  // Chapters folded open or shut by hand; by default those in progress are open.
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const needle = query.trim().toLowerCase();
  const filtering = contracting !== "all" || needle !== "";

  const shown = costs.chapters
    .filter((c) => chapter === "all" || c.code === chapter)
    .map((c) => ({
      ...c,
      lines: c.lines.filter(
        (line) =>
          MATCHES[contracting](line) &&
          (!needle || line.description.toLowerCase().includes(needle) || line.code.toLowerCase().includes(needle)),
      ),
    }))
    .filter((c) => !filtering || c.lines.length > 0);

  const expanded = (code: string) =>
    toggled[code] ?? (filtering || chapter !== "all" || costs.chapters.find((c) => c.code === code)?.state === "in_progress");

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
          onChange={setChapter}
          options={[{ value: "all", label: tf("all") }, ...costs.chapters.map((c) => ({ value: c.code, label: `${c.code} · ${c.name}` }))]}
        />
        <Segmented
          label={t("contracting")}
          value={contracting}
          onChange={setContracting}
          options={(["all", "closed", "open", "uncontracted", "overrun"] as const).map((key) => ({ key, label: t(`filter.${key}`) }))}
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t("search")}
          aria-label={t("search")}
          className="h-10 w-full max-w-[240px] bg-card"
        />
        <Link href={obraHref(projectId)} className={`${moreLink} md:ml-auto`}>
          {t("totalsInSummary")} →
        </Link>
      </div>

      <CostTable
        chapters={shown}
        expanded={expanded}
        onToggle={(code) => setToggled((all) => ({ ...all, [code]: !expanded(code) }))}
        orderHref={(id) => orderHref(projectId, id)}
        newOrderHref={canManage ? (code) => newOrderHref(projectId, code) : undefined}
      />

      <p className={footnote}>{t("footnote")}</p>
    </ObraFrame>
  );
}
