"use client";

// Container: the Trabajadores page, a page of workers at a time. The filters
// (access, text, company, obra) live in the URL and the server applies them:
// changing one loads its first page. "Comprobar acceso" asks the server.

import { useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { IdCard, Plus } from "lucide-react";
import type {
  AccessCheckResult,
  ProjectOption,
  SubcontractorError,
  WorkerAccessFilter,
  WorkersPage,
} from "@repo/core/contract";
import { checkWorkerAccessAction } from "../../../actions/subcontractors";
import { Button, buttonVariants } from "@/components/ui/button";
import { Pager } from "@/components/ui/pager";
import { useListQuery, useSearchText } from "../../components/useListQuery";
import AccessRulesCard from "../components/workers/AccessRulesCard";
import CheckAccessPanel from "../components/workers/CheckAccessPanel";
import WorkersKpis from "../components/workers/WorkersKpis";
import WorkersTable from "../components/workers/WorkersTable";

/** The filters as the URL has them: `?obra=&acceso=&empresa=&q=`. */
export type WorkersQuery = { projectId: string; access: WorkerAccessFilter; companyId: string; query: string };

export default function WorkersScreen({
  page,
  projects,
  companies,
  query,
  canManage,
}: {
  /** The page of workers the URL asks for, with the whole list's counts. */
  page: WorkersPage;
  projects: ProjectOption[];
  companies: { id: string; legalName: string }[];
  query: WorkersQuery;
  canManage: boolean;
}) {
  const t = useTranslations("subcontractors.workers");
  const list = useListQuery();
  const [text, setText] = useSearchText(query.query, (q) => list.set({ q }));
  const { projectId } = query;
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ result: AccessCheckResult | null; error?: SubcontractorError }>({ result: null });
  const [pending, startTransition] = useTransition();

  function runCheck(input: { query: string; projectId: string }) {
    startTransition(async () => {
      const response = await checkWorkerAccessAction({ query: input.query, projectId: input.projectId || null });
      setCheck("error" in response ? { result: null, error: response.error } : { result: response.result ?? null });
    });
  }

  return (
    <>
      <header className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">{t("eyebrow")}</p>
          <h1 className="mt-1">{t("title")}</h1>
          <p className="mt-1.5 text-[13px] text-muted-foreground">{t("intro")}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" aria-expanded={checking} onClick={() => setChecking((open) => !open)}>
            <IdCard aria-hidden />
            {t("checkAccess")}
          </Button>
          {canManage && (
            <Link href="/dashboard/subcontratas/trabajadores/nuevo" className={buttonVariants()}>
              <Plus aria-hidden />
              {t("register")}
            </Link>
          )}
        </div>
      </header>

      {checking && (
        <CheckAccessPanel
          projects={projects}
          projectId={projectId}
          pending={pending}
          result={check.result}
          error={check.error}
          onCheck={runCheck}
        />
      )}

      <WorkersKpis summary={page.summary} />

      <WorkersTable
        workers={page.workers}
        shown={page.paging.total}
        total={page.summary.registered}
        counts={page.counts}
        filter={query.access}
        onFilter={(access) => list.set({ acceso: access === "all" ? null : access })}
        query={text}
        onQuery={setText}
        companies={companies}
        companyId={query.companyId}
        onCompany={(empresa) => list.set({ empresa })}
        projects={projects}
        projectId={projectId}
        onProject={(obra) => list.set({ obra })}
        pager={<Pager paging={page.paging} hrefOf={list.pageHref} className="px-0" />}
      />

      <AccessRulesCard />
    </>
  );
}
