"use client";

// Container for Proyectos: every project, filtered by its budget, its obra and
// what is typed. The filters are kept in the URL (replaced, not pushed), so
// going back to the list finds them as they were, and "Volver a proyectos"
// remembers them (ProjectsBackLink). The views take props only.

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import ProjectFilterBar from "./components/ProjectFilterBar";
import { rememberListQuery } from "./components/ProjectsBackLink";
import ProjectsTable from "./components/ProjectsTable";
import { filterProjects, filtersQuery, hasFilters, NO_FILTERS, parseFilters, type ProjectFilters, type ProjectRow } from "./project-list";

export default function ProjectsListClient({
  projects,
  canCreate,
}: {
  projects: ProjectRow[];
  /** Admins and managers create projects; viewers only read. */
  canCreate: boolean;
}) {
  const t = useTranslations("projectsPage");
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const fromUrl = () => parseFilters(Object.fromEntries(searchParams));
  const [filters, setFilters] = useState(fromUrl);
  // A navigation to the list with other filters (the rail's Proyectos, the browser's back) wins over the state;
  // the URL this list writes itself always matches it.
  const [seenSearch, setSeenSearch] = useState(search);
  if (search !== seenSearch) {
    setSeenSearch(search);
    const next = fromUrl();
    if (filtersQuery(next) !== filtersQuery(filters)) setFilters(next);
  }
  useEffect(() => rememberListQuery(filtersQuery(filters)), [filters]);
  const query = useDeferredValue(filters.query);
  const { budget, obra } = filters;
  const { shown, budgetCounts, obraCounts } = useMemo(
    () => filterProjects(projects, { budget, obra, query }),
    [projects, budget, obra, query],
  );
  const filtered = hasFilters(filters);

  const update = (next: ProjectFilters) => {
    setFilters(next);
    try {
      window.history.replaceState(null, "", `${window.location.pathname}${filtersQuery(next)}`);
    } catch {
      // Safari limits replaceState calls (a held-down key while typing); the list still filters.
    }
  };
  const clear = () => update(NO_FILTERS);

  return (
    <>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="flex items-center text-[13px] font-medium text-muted-foreground">
          {filtered ? t("countFiltered", { shown: shown.length, total: projects.length }) : t("count", { count: projects.length })}
        </span>
        {canCreate && (
          <Link href="/dashboard/projects/new" className={cn(buttonVariants(), "ml-auto")}>
            + {t("newProject")}
          </Link>
        )}
      </div>

      {projects.length === 0 ? (
        <p className="py-10 text-center text-[13.5px] text-muted-foreground">{t("empty")}</p>
      ) : (
        <section className={cardVariants({ size: "flush" })} aria-label={t("listLabel")}>
          <ProjectFilterBar
            filters={filters}
            budgetCounts={budgetCounts}
            obraCounts={obraCounts}
            onChange={(change) => update({ ...filters, ...change })}
            onClear={filtered ? clear : null}
          />
          {shown.length > 0 ? (
            <ProjectsTable rows={shown} />
          ) : (
            <div className="flex flex-col items-center gap-2 px-[18px] py-10 text-center">
              <p className="m-0 text-[13.5px] text-muted-foreground">{t("noMatch")}</p>
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
