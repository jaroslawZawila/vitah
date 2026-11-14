import { canEdit } from "@repo/core";
import { DEFAULT_PAGE_SIZE, WORKER_ACCESS_FILTERS } from "@repo/core/contract";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/access";
import { choiceParam, lastPageUrl, pageParam, param, type SearchParams } from "../../../../lib/list-query";
import { getCompanyOptions, getSubcontractorProjects, getWorkersPage } from "../../../actions/subcontractors";
import WorkersScreen, { type WorkersQuery } from "./WorkersScreen";

/**
 * Subcontratas › Trabajadores, a page at a time. Its filters are in the URL
 * (`?obra=&acceso=&empresa=&q=&page=`): the server applies them.
 */
export default async function WorkersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;
  const query: WorkersQuery = {
    projectId: param(params, "obra"),
    access: choiceParam(params, "acceso", WORKER_ACCESS_FILTERS),
    companyId: param(params, "empresa"),
    query: param(params, "q"),
  };
  const [ctx, page, projects, companies] = await Promise.all([
    requireSession(),
    getWorkersPage({ ...query, q: query.query, page: pageParam(params), limit: DEFAULT_PAGE_SIZE }),
    getSubcontractorProjects(),
    getCompanyOptions(),
  ]);
  if (!page) notFound();
  // A page past the end (a worker removed on the last one, an old bookmark): the last there is.
  const last = lastPageUrl("/dashboard/subcontratas/trabajadores", params, page.paging);
  if (last) redirect(last);
  return (
    <WorkersScreen
      page={page}
      projects={projects ?? []}
      companies={companies ?? []}
      query={query}
      canManage={canEdit(ctx.role)}
    />
  );
}
