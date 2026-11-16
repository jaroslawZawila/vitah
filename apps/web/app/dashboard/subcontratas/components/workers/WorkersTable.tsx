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
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { touchLink, stretchedLink } from "../../../components/touch";
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
  shown = workers.length,
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
  pager,
}: {
  /** The page shown of the workers left after the filters. */
  workers: WorkerListItem[];
  /** How many the filters leave, of how many there are (`total`). */
  shown?: number;
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
  /** A paged list's foot. */
  pager?: React.ReactNode;
}) {
  const t = useTranslations("subcontractors");
  const tw = useTranslations("subcontractors.workers");
  const reason = useAccessReason();
  /** A worker's documents, as the table's columns: each heading with its pill. */
  const docColumns = (w: WorkerListItem): [string, React.ReactNode][] => {
    const waiver = w.docs.renuncia_vigilancia_salud;
    const tpc = w.docs.tpc;
    return [
      [tw("table.ss"), <Cell key="ss" badge={w.docs.alta_ss} />],
      [tw("table.tpc"), !tpc || tpc.state === "missing" ? <Badge key="tpc" variant="outline">{tw("noTpc")}</Badge> : <Cell key="tpc" badge={tpc} />],
      [tw("table.training"), <Cell key="training" badge={worstBadge([w.docs.formacion_prl_inicial ?? MISSING, w.docs.formacion_prl_oficio ?? MISSING])} />],
      [
        tw("table.medical"),
        waiver && isValid(waiver.state) ? <Badge key="medical" variant="outline">{tw("waiver")}</Badge> : <Cell key="medical" badge={w.docs.aptitud_medica} />,
      ],
      [tw("table.ppe"), <Cell key="ppe" badge={w.docs.entrega_epis} />],
    ];
  };

  return (
    <Card aria-labelledby="workers-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="workers-title">{tw("listTitle")}</h2>
        <span className="text-meta text-muted-foreground">{tw("showing", { shown, total })}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={tw("filterLabel")}>
          {ACCESS_FILTERS.map((key) => (
            <ToggleChip key={key} tone="solid" on={filter === key} onToggle={() => onFilter(key)}>
              {tw(`filters.${key}`)} <span className="num text-xs">{counts[key]}</span>
            </ToggleChip>
          ))}
        </div>
        <label className="flex min-h-11 min-w-0 flex-[1_1_220px] items-center gap-2 rounded-md border bg-raise px-3 text-muted-foreground lg:min-h-9 lg:pointer-coarse:min-h-11">
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
        <p className="py-8 text-center text-sm text-muted-foreground">{tw("empty")}</p>
      ) : (
        <>
        {/* Phones: one card per worker, opening their page; their documents as labelled pills. */}
        <ul className="m-0 flex list-none flex-col p-0 md:hidden">
          {workers.map((w) => {
            const firstReason = w.access.checks.find((c) => !c.ok)?.reasons[0];
            return (
              <li key={w.id} className="relative flex flex-col gap-1.5 border-t py-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Link href={workerHref(w.id)} className={cn("font-semibold hover:text-primary", stretchedLink)}>
                    {workerName(w)}
                  </Link>
                  <AccessBadge status={w.access.status} />
                </div>
                <div className="text-meta text-muted-foreground">
                  <span className="num">{w.idDocumentMasked}</span> · {w.subcontractorName}
                </div>
                <div className="text-sm">
                  {w.trade ? t(`trades.${w.trade}`) : "—"}
                  {w.category && <span className="text-muted-foreground"> · {t(`categories.${w.category}`)}</span>}
                  {w.roles.length > 0 && <span className="text-muted-foreground"> · {w.roles.map((role) => t(`roles.${role}`)).join(", ")}</span>}
                </div>
                {firstReason && <div className="text-meta text-muted-foreground">{reason(firstReason, w.subcontractorKind)}</div>}
                <dl className="m-0 mt-1 flex flex-wrap gap-x-3 gap-y-1.5">
                  {docColumns(w).map(([label, badge]) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <dt className="text-meta text-muted-foreground">{label}</dt>
                      <dd className="m-0">{badge}</dd>
                    </div>
                  ))}
                </dl>
              </li>
            );
          })}
        </ul>
        <div className="hidden md:block">
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead>{tw("table.worker")}</TableHead>
              <TableHead>{tw("table.company")}</TableHead>
              <TableHead className="whitespace-normal">{tw("table.trade")}</TableHead>
              <TableHead>{tw("table.ss")}</TableHead>
              <TableHead>{tw("table.tpc")}</TableHead>
              {/* Two-word headings wrap: the column is as wide as its pills, and the table fits the card. */}
              <TableHead className="whitespace-normal">{tw("table.training")}</TableHead>
              <TableHead className="whitespace-normal">{tw("table.medical")}</TableHead>
              <TableHead>{tw("table.ppe")}</TableHead>
              <TableHead>{tw("table.roles")}</TableHead>
              <TableHead className="whitespace-normal">{tw("table.access")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {workers.map((w) => {
              const firstReason = w.access.checks.find((c) => !c.ok)?.reasons[0];
              return (
                <TableRow key={w.id}>
                  <TableCell className="min-w-32 whitespace-normal">
                    <Link href={workerHref(w.id)} className={cn("font-semibold underline-offset-3 hover:underline", touchLink)}>
                      {workerName(w)}
                    </Link>
                    <div className="num text-meta text-muted-foreground">{w.idDocumentMasked}</div>
                  </TableCell>
                  <TableCell className="min-w-28 text-meta whitespace-normal">{w.subcontractorName}</TableCell>
                  <TableCell className="min-w-28 whitespace-normal">
                    {w.trade ? t(`trades.${w.trade}`) : "—"}
                    <div className="text-meta text-muted-foreground">{w.category ? t(`categories.${w.category}`) : "—"}</div>
                  </TableCell>
                  {docColumns(w).map(([label, badge]) => (
                    <TableCell key={label}>{badge}</TableCell>
                  ))}
                  <TableCell className="min-w-24 text-meta whitespace-normal">
                    {w.roles.length > 0 ? w.roles.map((role) => t(`roles.${role}`)).join(", ") : "—"}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <AccessBadge status={w.access.status} />
                    {firstReason && (
                      <div className="mt-1 max-w-52 text-meta text-muted-foreground">
                        {reason(firstReason, w.subcontractorKind)}
                      </div>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        </div>
        </>
      )}
      {pager}
    </Card>
  );
}
