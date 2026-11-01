"use client";

import Link from "next/link";
import { useFormatter, useNow, useTranslations } from "next-intl";
import { ChevronRight, FolderOpen } from "lucide-react";
import { budgetSituation, perM2High, type BudgetOverviewItem } from "@repo/core/contract";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useControlFormat } from "../../[id]/components/construction/format";
import { useObraFormat } from "../../[id]/components/obra/format";
import { Dash } from "../../[id]/components/construction/SummaryTable";
import BudgetPill from "./BudgetPill";
import { SITUATION_CLASS, useSituationText } from "./situation";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** "hace 2 horas" within a week, else the day. */
function useActivity() {
  const format = useFormatter();
  const now = useNow();
  const f = useObraFormat();
  return (iso: string) => {
    const at = new Date(iso);
    // The day in Spain, as the rest of the portal dates things.
    return now.getTime() - at.getTime() < WEEK_MS ? format.relativeTime(at, now) : f.date(at.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" }));
  };
}

/** A link stretched over its row or card (`relative` on it), under the "Proyecto" link. */
const stretched = "after:absolute after:inset-0 hover:text-primary";
const projectLinkClass =
  "relative z-10 inline-flex min-h-9 items-center gap-1.5 rounded-lg border bg-card px-2.5 text-[12.5px] font-semibold whitespace-nowrap transition-colors hover:bg-raise pointer-coarse:min-h-11";

/**
 * Presentational: every obra's budget, as a table from 768px and as cards on
 * phones. A row opens the obra's budget; its "Proyecto" link, the project.
 */
export default function BudgetsTable({
  items,
  budgetHref,
  projectHref,
  empty,
}: {
  /** Already filtered. */
  items: BudgetOverviewItem[];
  budgetHref: (projectId: string) => string;
  projectHref: (projectId: string) => string;
  empty: string;
}) {
  const t = useTranslations("budgetsOverview");
  const f = useObraFormat();
  const pct = useControlFormat();
  const activity = useActivity();
  const words = useSituationText();

  if (items.length === 0) {
    return <p className="px-[18px] py-6 text-center text-[13.5px] text-muted-foreground">{empty}</p>;
  }

  const figures = (item: BudgetOverviewItem) => {
    const r = item.revision;
    return {
      price: r ? f.money(r.totalCents) : null,
      contract: r && r.contractTotalCents !== r.totalCents ? t("contract", { amount: f.money(r.contractTotalCents) }) : null,
      margin: r && r.totalCents ? f.ratio(r.totalCents - r.costCents, r.totalCents) : null,
      perM2: r?.perM2Cents != null ? f.money(r.perM2Cents) : null,
      delta: r?.perM2DeltaBp != null ? t("delta", { delta: pct.signedPct(r.perM2DeltaBp) }) : null,
    };
  };
  const projectLink = (item: BudgetOverviewItem) => (
    <Link href={projectHref(item.projectId)} className={projectLinkClass} aria-label={t("openProjectOf", { ref: item.ref })}>
      <FolderOpen aria-hidden className="size-3.5" />
      {t("project")}
    </Link>
  );

  return (
    <>
      {/* Phones: one card per obra. */}
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0 px-3 pb-3 md:hidden" aria-label={t("table.label")}>
        {items.map((item) => {
          const s = budgetSituation(item);
          const n = figures(item);
          return (
            <li key={item.projectId} className="relative flex flex-col gap-1 rounded-xl border bg-card px-4 py-3.5 shadow-card">
              <div className="flex items-center justify-between gap-2.5">
                <span className="num font-semibold text-brand-ink">{item.ref}</span>
                <BudgetPill item={item} />
              </div>
              <Link href={budgetHref(item.projectId)} className={cn("font-semibold", stretched)} aria-label={t("openBudget", { ref: item.ref })}>
                {item.clientName ?? item.address}
              </Link>
              {item.clientName && <span className="text-[12.5px] text-muted-foreground">{item.address}</span>}
              <div className="mt-1.5 flex items-baseline justify-between gap-2.5 border-t pt-2 text-[13px]">
                <span className="num font-semibold">{n.price ?? "—"}</span>
                <span className={cn("text-right font-semibold", SITUATION_CLASS[s.kind])}>{words.label(s)}</span>
              </div>
              <div className="flex justify-end">{projectLink(item)}</div>
            </li>
          );
        })}
      </ul>

      {/* From 768px: the table. */}
      <div className="hidden md:block">
        <Table className="min-w-[1080px] text-[13px]" aria-label={t("table.label")}>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-[18px]">{t("table.obra")}</TableHead>
              <TableHead>{t("table.revision")}</TableHead>
              <TableHead className="text-right">{t("table.price")}</TableHead>
              <TableHead className="text-right">{t("table.margin")}</TableHead>
              <TableHead className="text-right">{t("table.perM2")}</TableHead>
              <TableHead>{t("table.situation")}</TableHead>
              <TableHead>{t("table.activity")}</TableHead>
              <TableHead className="pr-[18px] text-right">{t("table.open")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const s = budgetSituation(item);
              const n = figures(item);
              return (
                <TableRow key={item.projectId} className="relative">
                  <TableCell className="max-w-[320px] min-w-[240px] pl-[18px] whitespace-normal">
                    <Link href={budgetHref(item.projectId)} className={stretched} aria-label={t("openBudget", { ref: item.ref })}>
                      <b className="num text-brand-ink">{item.ref}</b>
                      {item.clientName && <span> · {item.clientName}</span>}
                    </Link>
                    <div className="truncate text-[12px] text-muted-foreground">{item.address}</div>
                  </TableCell>
                  <TableCell>
                    <BudgetPill item={item} />
                  </TableCell>
                  <TableCell className="text-right">
                    <span className="num">{n.price ?? <Dash />}</span>
                    {n.contract && <div className="text-[12px] text-muted-foreground">{n.contract}</div>}
                  </TableCell>
                  <TableCell className="num text-right">{n.margin ?? <Dash />}</TableCell>
                  <TableCell className="text-right">
                    <span className="num">{n.perM2 ?? <Dash />}</span>
                    {n.delta && <div className={cn("text-[12px]", perM2High(item.revision?.perM2DeltaBp) ? "font-semibold text-warn" : "text-muted-foreground")}>{n.delta}</div>}
                  </TableCell>
                  <TableCell className="min-w-[200px] whitespace-normal">
                    <div className={cn("font-semibold", SITUATION_CLASS[s.kind])}>{words.label(s)}</div>
                    <div className="text-[12px] text-muted-foreground">{words.detail(s)}</div>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">{activity(item.updatedAt)}</TableCell>
                  <TableCell className="pr-[18px] text-right">
                    <span className="inline-flex items-center gap-1.5">
                      {projectLink(item)}
                      <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </>
  );
}
