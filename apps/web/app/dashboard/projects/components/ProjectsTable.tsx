"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { obraFilterOf, type ObraFilter, type ObraStage } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { budgetHref } from "../[id]/components/budget/links";
import { obraHref, StagePill } from "../[id]/components/construction/ObraFrame";
import type { ProjectRow } from "../project-list";
import BudgetPill from "./budgets/BudgetPill";

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
 * cards on phones. The pills open the project's budget and obra; "Ver" (or the
 * card) the project.
 */
export default function ProjectsTable({ rows }: { rows: ProjectRow[] }) {
  const t = useTranslations("projectsPage");
  const format = useFormatter();
  // Calendar dates are stored at UTC midnight.
  const formatDate = (date: Date | null) => (date ? format.dateTime(date, { dateStyle: "medium", timeZone: "UTC" }) : "—");
  const client = (row: ProjectRow) => row.clientName ?? t("table.noClient");

  return (
    <>
      <div className="hidden px-[18px] pb-1.5 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.ref")}</TableHead>
              <TableHead>{t("table.address")}</TableHead>
              <TableHead>{t("table.client")}</TableHead>
              <TableHead>{t("table.startDate")}</TableHead>
              <TableHead>{t("table.completionDate")}</TableHead>
              <TableHead>{t("table.budget")}</TableHead>
              <TableHead>{t("table.obra")}</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="num font-semibold text-primary">{row.ref}</TableCell>
                <TableCell className="min-w-48 whitespace-normal">{row.address}</TableCell>
                <TableCell className="text-muted-foreground">{client(row)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(row.startDate)}</TableCell>
                <TableCell className="text-muted-foreground">{formatDate(row.completionDate)}</TableCell>
                <TableCell>
                  <Link href={budgetHref(row.id, "")} className={pillLinkClass}>
                    <ProjectBudgetPill budget={row.budget} />
                  </Link>
                </TableCell>
                <TableCell>
                  <Link href={obraHref(row.id)} className={pillLinkClass}>
                    <StagePill stage={row.obraStage as ObraStage} variant={OBRA_VARIANT[obraFilterOf(row.obraStage)]} />
                  </Link>
                </TableCell>
                <TableCell className="text-right">
                  <Link href={projectHref(row.id)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                    {t("table.view")}
                  </Link>
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
                <span className="num text-[12.5px] font-semibold text-primary">{row.ref}</span>
                <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
              </span>
              <span className="text-[14px] font-medium">{row.address}</span>
              <span className="text-[13px] text-muted-foreground">{client(row)}</span>
              <span className="flex flex-wrap gap-1.5">
                <ProjectBudgetPill budget={row.budget} />
                <StagePill stage={row.obraStage as ObraStage} variant={OBRA_VARIANT[obraFilterOf(row.obraStage)]} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}
