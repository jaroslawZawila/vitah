"use client";

// Container: the Trabajadores page. Filters by access, text and company in the
// browser; the obra filter reloads the page (`?obra=`) so access is worked
// out for that obra on the server. "Comprobar acceso" asks the server.

import { useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { IdCard, Plus } from "lucide-react";
import {
  workerName,
  type AccessCheckResult,
  type ProjectOption,
  type SubcontractorError,
  type WorkerListItem,
} from "@repo/core/contract";
import { checkWorkerAccessAction } from "../../../actions/subcontractors";
import { Button, buttonVariants } from "@/components/ui/button";
import AccessRulesCard from "../components/workers/AccessRulesCard";
import CheckAccessPanel from "../components/workers/CheckAccessPanel";
import WorkersKpis from "../components/workers/WorkersKpis";
import WorkersTable, { ACCESS_FILTERS, type AccessFilter } from "../components/workers/WorkersTable";

export default function WorkersScreen({
  workers,
  projects,
  companies,
  projectId,
  canManage,
}: {
  workers: WorkerListItem[];
  projects: ProjectOption[];
  companies: { id: string; legalName: string }[];
  projectId: string;
  canManage: boolean;
}) {
  const t = useTranslations("subcontractors.workers");
  const router = useRouter();
  const pathname = usePathname();
  const [filter, setFilter] = useState<AccessFilter>("all");
  const [query, setQuery] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [checking, setChecking] = useState(false);
  const [check, setCheck] = useState<{ result: AccessCheckResult | null; error?: SubcontractorError }>({ result: null });
  const [pending, startTransition] = useTransition();

  const q = query.trim().toLowerCase();
  const matching = workers.filter(
    (w) =>
      (!companyId || w.subcontractorId === companyId) &&
      (!q || `${workerName(w)} ${w.subcontractorName}`.toLowerCase().includes(q)),
  );
  const counts = Object.fromEntries(
    ACCESS_FILTERS.map((key) => [key, key === "all" ? matching.length : matching.filter((w) => w.access.status === key).length]),
  ) as Record<AccessFilter, number>;
  const shown = filter === "all" ? matching : matching.filter((w) => w.access.status === filter);

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

      <WorkersKpis workers={workers} />

      <WorkersTable
        workers={shown}
        total={workers.length}
        counts={counts}
        filter={filter}
        onFilter={setFilter}
        query={query}
        onQuery={setQuery}
        companies={companies}
        companyId={companyId}
        onCompany={setCompanyId}
        projects={projects}
        projectId={projectId}
        onProject={(id) => router.push(id ? `${pathname}?obra=${encodeURIComponent(id)}` : pathname)}
      />

      <AccessRulesCard />
    </>
  );
}
