"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { obraFilterOf, type ObraFilter, type ObraStage } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFormat } from "@/lib/format";
import { budgetHref } from "../[id]/components/budget/links";
import { obraHref, StagePill } from "../[id]/components/construction/ObraFrame";
import type { ProjectRow } from "../project-list";
import BudgetPill from "./budgets/BudgetPill";
import { AttentionPill, AttentionText, ProgressFigure, SchedulePill } from "./ProjectSignals";

const projectHref = (id: string) => `/dashboard/projects/${id}`;

const OBRA_VARIANT: Record<Exclude<ObraFilter, "all">, "outline" | "default" | "good"> = {
  not_started: "outline",
  execution: "default",
  finished: "good",
};

const pillLinkClass =
  "inline-flex items-center rounded-full transition-opacity hover:opacity-80 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11";

/** Presentational: the budget's pill, or the AI's failed first draft (else it would read as no budget at all). */
function ProjectBudgetPill({ budget }: { budget: ProjectRow["budget"] }) {
  const t = useTranslations("budgetsOverview.pill");
  if (!budget.revision && budget.generation?.status === "failed") return <Badge variant="destructive">{t("failed")}</Badge>;
  return <BudgetPill item={budget} />;
}

/**
 * Presentational: the projects, already filtered, as a table from 768px and as
 * cards on phones. The reference (or the card) opens the project; the pills its
 * budget, obra and schedule; the attention count its reasons. Below 1280px the
 * dates are left out, so the signals fit beside the sidebar.
 */
export default function ProjectsTable({ rows }: { rows: ProjectRow[] }) {
  const t = useTranslations("projectsPage");
  const format = useFormat();
  const client = (row: ProjectRow) => row.clientName ?? t("table.noClient");

  return (
    <>
      <div className="hidden px-[18px] pb-1.5 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.project")}</TableHead>
              <TableHead className="hidden xl:table-cell">{t("table.startDate")}</TableHead>
              <TableHead className="hidden xl:table-cell">{t("table.completionDate")}</TableHead>
              <TableHead>{t("table.budgetObra")}</TableHead>
              <TableHead>{t("table.scheduleProgress")}</TableHead>
              <TableHead>{t("table.attention")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="min-w-44 whitespace-normal">
                  <Link href={projectHref(row.id)} className="num font-semibold text-primary underline-offset-2 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">
                    {row.ref}
                  </Link>
                  <span className="block">{row.address}</span>
                  <span className="block text-meta text-muted-foreground">{client(row)}</span>
                </TableCell>
                <TableCell className="hidden text-muted-foreground xl:table-cell">{format.date(row.startDate)}</TableCell>
                <TableCell className="hidden text-muted-foreground xl:table-cell">{format.date(row.completionDate)}</TableCell>
                <TableCell>
                  <span className="flex flex-col items-start gap-1">
                    <Link href={budgetHref(row.id, "")} className={pillLinkClass}>
                      <ProjectBudgetPill budget={row.budget} />
                    </Link>
                    <Link href={obraHref(row.id)} className={pillLinkClass}>
                      <StagePill stage={row.obraStage as ObraStage} variant={OBRA_VARIANT[obraFilterOf(row.obraStage)]} />
                    </Link>
                  </span>
                </TableCell>
                <TableCell>
                  <span className="flex flex-col items-start gap-1.5">
                    {row.schedule && (
                      <Link href={obraHref(row.id, "planning")} className={pillLinkClass}>
                        <SchedulePill schedule={row.schedule} />
                      </Link>
                    )}
                    {row.progressPct !== null && <ProgressFigure pct={row.progressPct} />}
                  </span>
                </TableCell>
                <TableCell>
                  {row.attention.length > 0 && <AttentionPill projectId={row.id} projectRef={row.ref} attention={row.attention} />}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <ul className="m-0 flex list-none flex-col p-0 md:hidden">
        {rows.map((row) => (
          <li key={row.id} className="border-b last:border-b-0">
            <Link href={projectHref(row.id)} className="flex flex-col gap-2 px-[18px] py-3.5 transition-colors hover:bg-raise">
              <span className="flex items-center justify-between gap-2">
                <span className="num text-meta font-semibold text-primary">{row.ref}</span>
                <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
              </span>
              <span className="text-sm font-medium">{row.address}</span>
              <span className="text-meta text-muted-foreground">{client(row)}</span>
              <span className="flex flex-wrap items-center gap-1.5">
                <ProjectBudgetPill budget={row.budget} />
                <StagePill stage={row.obraStage as ObraStage} variant={OBRA_VARIANT[obraFilterOf(row.obraStage)]} />
                {row.schedule && <SchedulePill schedule={row.schedule} />}
                {row.progressPct !== null && <ProgressFigure pct={row.progressPct} className="ml-1" />}
              </span>
              {row.attention.length > 0 && <AttentionText attention={row.attention} />}
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
