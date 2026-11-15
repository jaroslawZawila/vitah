"use client";

// Container for Proyectos: every project, filtered by its budget, its obra, what
// needs attention and what is typed. The filters are kept in the URL (replaced, not pushed), so
// going back to the list finds them as they were, and "Volver a proyectos"
// remembers them (ProjectsBackLink). The views take props only.

import Link from "next/link";
import { useDeferredValue, useEffect, useMemo } from "react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import ProjectFilterBar from "./components/ProjectFilterBar";
import { useUrlState } from "../components/useUrlState";
import { rememberListQuery } from "./components/ProjectsBackLink";
import ProjectsTable from "./components/ProjectsTable";
import { filterProjects, filtersQuery, hasFilters, NO_FILTERS, parseFilters, type ProjectFilters, type ProjectRow } from "./project-list";

const readFilters = (params: URLSearchParams) => parseFilters(Object.fromEntries(params));

/** The filters as the URL's parameters: only those set, in the list's order. */
const filterParams = ({ budget, obra, attention, query }: ProjectFilters) => ({
  presupuesto: budget === "all" ? null : budget,
  obra: obra === "all" ? null : obra,
  atencion: attention === "all" ? null : attention,
  q: query.trim() ? query : null,
});

export default function ProjectsListClient({
  projects,
  canCreate,
}: {
  projects: ProjectRow[];
  /** Admins and managers create projects; viewers only read. */
  canCreate: boolean;
}) {
  const t = useTranslations("projectsPage");
  const [filters, update] = useUrlState(readFilters, filterParams);
  useEffect(() => rememberListQuery(filtersQuery(filters)), [filters]);
  const query = useDeferredValue(filters.query);
  const { budget, obra, attention } = filters;
  const { shown, budgetCounts, obraCounts, attentionCounts } = useMemo(
    () => filterProjects(projects, { budget, obra, attention, query }),
    [projects, budget, obra, attention, query],
  );
  const filtered = hasFilters(filters);

  const clear = () => update(NO_FILTERS);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center text-sm font-medium text-muted-foreground">
          {filtered ? t("countFiltered", { shown: shown.length, total: projects.length }) : t("count", { count: projects.length })}
        </span>
        {canCreate && (
          <Link href="/dashboard/projects/new" className={cn(buttonVariants(), "ml-auto")}>
            + {t("newProject")}
          </Link>
        )}
      </div>

      {projects.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <section className={cardVariants({ size: "flush" })} aria-label={t("listLabel")}>
          <ProjectFilterBar
            filters={filters}
            budgetCounts={budgetCounts}
            obraCounts={obraCounts}
            attentionCounts={attentionCounts}
            onChange={(change) => update({ ...filters, ...change })}
            onClear={filtered ? clear : null}
          />
          {shown.length > 0 ? (
            <ProjectsTable rows={shown} />
          ) : (
            <div className="flex flex-col items-center gap-2 px-[18px] py-10 text-center">
              <p className="m-0 text-sm text-muted-foreground">{t("noMatch")}</p>
              <button type="button" onClick={clear} className={buttonVariants({ variant: "outline", size: "sm" })}>
                {t("filters.clear")}
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
