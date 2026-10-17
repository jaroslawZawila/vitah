"use client";

// Container for Subcontratas › Empresas: the only part that knows about server
// actions. It owns the filters; the views in ../components/companies take props only.

import { useState, useTransition } from "react";
import type { AttentionItem, SubcontractorError, SubcontractorsOverview } from "@repo/core/contract";
import { requestSubcontractorDocumentsAction } from "../../../actions/subcontractors";
import FormError from "../../components/FormError";
import AttentionList from "../components/companies/AttentionList";
import CompaniesHeader from "../components/companies/CompaniesHeader";
import CompaniesKpis from "../components/companies/CompaniesKpis";
import CompaniesTable, { NO_FILTER, type CompanyFilter } from "../components/companies/CompaniesTable";
import { dossierUrl } from "../components/display";

export default function CompaniesScreen({
  overview,
  canManage,
}: {
  overview: SubcontractorsOverview;
  canManage: boolean;
}) {
  const [filter, setFilter] = useState<CompanyFilter>(NO_FILTER);
  const [error, setError] = useState<SubcontractorError | undefined>();
  const [busy, startTransition] = useTransition();
  const kinds = new Map(overview.companies.map((c) => [c.id, c.kind]));

  function request(item: AttentionItem) {
    setError(undefined);
    startTransition(async () => {
      const result = await requestSubcontractorDocumentsAction(item.subcontractorId, {
        requirementIds: item.requirementIds,
        ...(item.workerId ? { workerId: item.workerId } : {}),
        ...(item.projectId ? { projectId: item.projectId } : {}),
      });
      // Its revalidatePath brings the updated page back with it.
      if (result?.error) setError(result.error);
    });
  }

  return (
    <>
      <CompaniesHeader dossierHref={dossierUrl({ projectId: filter.projectId || null })} canManage={canManage} />
      <CompaniesKpis overview={overview} />
      <FormError namespace="subcontractors.errors" error={error} />
      <AttentionList
        items={overview.attention}
        kindOf={(id) => kinds.get(id) ?? "company"}
        canManage={canManage}
        busy={busy}
        onRequest={request}
      />
      <CompaniesTable
        companies={overview.companies}
        projects={overview.projects}
        filter={filter}
        onFilterChange={setFilter}
      />
    </>
  );
}
