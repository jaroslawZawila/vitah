"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Search } from "lucide-react";
import {
  isValid,
  workerName,
  worstBadge,
  type DocBadge,
  type ProjectOption,
  type WorkerAccessStatus,
  type WorkerListItem,
} from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AccessBadge, DocStateBadge } from "../Badges";
import ToggleChip from "../fields/ToggleChip";
import { useAccessReason, workerHref } from "../display";

export type AccessFilter = "all" | WorkerAccessStatus;
export const ACCESS_FILTERS: AccessFilter[] = ["all", "ok", "pending", "blocked"];

const MISSING: DocBadge = { state: "missing", daysLeft: null };

function Cell({ badge }: { badge: DocBadge | undefined }) {
  const b = badge ?? MISSING;
  return <DocStateBadge state={b.state} daysLeft={b.daysLeft} short />;
}

/** Presentational: the workers table with its filters (state lives in the container). */
export default function WorkersTable({
  workers,
  total,
  counts,
  filter,
  onFilter,
  query,
  onQuery,
  companies,
  companyId,
  onCompany,
  projects,
  projectId,
  onProject,
}: {
  /** The workers left after the filters. */
  workers: WorkerListItem[];
  total: number;
  counts: Record<AccessFilter, number>;
  filter: AccessFilter;
  onFilter: (filter: AccessFilter) => void;
  query: string;
  onQuery: (query: string) => void;
  companies: { id: string; legalName: string }[];
  companyId: string;
  onCompany: (id: string) => void;
  projects: ProjectOption[];
  projectId: string;
  onProject: (id: string) => void;
}) {
  const t = useTranslations("subcontractors");
  const tw = useTranslations("subcontractors.workers");
  const reason = useAccessReason();

  return (
    <Card aria-labelledby="workers-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="workers-title">{tw("listTitle")}</h2>
        <span className="text-[12.5px] text-muted-foreground">{tw("showing", { shown: workers.length, total })}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={tw("filterLabel")}>
          {ACCESS_FILTERS.map((key) => (
            <ToggleChip key={key} tone="solid" on={filter === key} onToggle={() => onFilter(key)}>
              {tw(`filters.${key}`)} <span className="num text-[11.5px] opacity-80">{counts[key]}</span>
            </ToggleChip>
          ))}
        </div>
        <label className="flex min-h-11 min-w-0 flex-[1_1_220px] items-center gap-2 rounded-md border bg-raise px-3 text-muted-foreground lg:min-h-9">
          <Search aria-hidden className="size-4" />
          <input
            type="search"
            className="w-full min-w-0 border-0 bg-transparent text-sm text-foreground outline-none"
            placeholder={tw("search")}
            aria-label={tw("search")}
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
        </label>
        <NativeSelect className="w-auto min-w-44" aria-label={tw("company")} value={companyId} onChange={(e) => onCompany(e.target.value)}>
          <NativeSelectOption value="">{tw("allCompanies")}</NativeSelectOption>
          {companies.map((c) => (
            <NativeSelectOption key={c.id} value={c.id}>
              {c.legalName}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect className="w-auto min-w-44" aria-label={tw("project")} value={projectId} onChange={(e) => onProject(e.target.value)}>
          <NativeSelectOption value="">{tw("allProjects")}</NativeSelectOption>
          {projects.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.ref}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {workers.length === 0 ? (
        <p className="py-8 text-center text-[13.5px] text-muted-foreground">{tw("empty")}</p>
      ) : (
        <Table className="min-w-[1180px]">
          <TableHeader>
            <TableRow>
              <TableHead>{tw("table.worker")}</TableHead>
              <TableHead>{tw("table.company")}</TableHead>
              <TableHead>{tw("table.trade")}</TableHead>
              <TableHead>{tw("table.ss")}</TableHead>
              <TableHead>{tw("table.tpc")}</TableHead>
              <TableHead>{tw("table.training")}</TableHead>
              <TableHead>{tw("table.medical")}</TableHead>
              <TableHead>{tw("table.ppe")}</TableHead>
              <TableHead>{tw("table.roles")}</TableHead>
              <TableHead>{tw("table.access")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workers.map((w) => {
              const firstReason = w.access.checks.find((c) => !c.ok)?.reasons[0];
              const waiver = w.docs.renuncia_vigilancia_salud;
              const tpc = w.docs.tpc;
              return (
                <TableRow key={w.id}>
                  <TableCell>
                    <Link href={workerHref(w.id)} className="font-semibold underline-offset-3 hover:underline">
                      {workerName(w)}
                    </Link>
                    <div className="num text-[12.5px] text-muted-foreground">{w.idDocumentMasked}</div>
                  </TableCell>
                  <TableCell className="text-[12.5px]">{w.subcontractorName}</TableCell>
                  <TableCell>
                    {w.trade ? t(`trades.${w.trade}`) : "—"}
                    <div className="text-[12.5px] text-muted-foreground">{w.category ? t(`categories.${w.category}`) : "—"}</div>
                  </TableCell>
                  <TableCell>
                    <Cell badge={w.docs.alta_ss} />
                  </TableCell>
                  <TableCell>
                    {!tpc || tpc.state === "missing" ? (
                      <Badge variant="outline">{tw("noTpc")}</Badge>
                    ) : (
                      <Cell badge={tpc} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Cell badge={worstBadge([w.docs.formacion_prl_inicial ?? MISSING, w.docs.formacion_prl_oficio ?? MISSING])} />
                  </TableCell>
                  <TableCell>
                    {waiver && isValid(waiver.state) ? (
                      <Badge variant="outline">{tw("waiver")}</Badge>
                    ) : (
                      <Cell badge={w.docs.aptitud_medica} />
                    )}
                  </TableCell>
                  <TableCell>
                    <Cell badge={w.docs.entrega_epis} />
                  </TableCell>
                  <TableCell className="text-[12.5px]">
                    {w.roles.length > 0 ? w.roles.map((role) => t(`roles.${role}`)).join(", ") : "—"}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <AccessBadge status={w.access.status} />
                    {firstReason && (
                      <div className="mt-1 max-w-52 text-[12.5px] text-muted-foreground">
                        {reason(firstReason, w.subcontractorKind)}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}
