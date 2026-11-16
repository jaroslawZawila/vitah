"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight, Search } from "lucide-react";
import {
  DOC_PILLARS,
  companyType,
  type CompanyStatus,
  type ProjectOption,
  type SubcontractorListItem,
} from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { touchLink, stretchedLink } from "../../../components/touch";
import { CompanyStatusBadge, DocStateBadge } from "../Badges";
import ToggleChip from "../fields/ToggleChip";
import { companyHref } from "../display";

export type CompanyFilter = {
  status: CompanyStatus | "all";
  query: string;
  trade: string;
  projectId: string;
};

export const NO_FILTER: CompanyFilter = { status: "all", query: "", trade: "", projectId: "" };

/** The companies a filter keeps: by status, name or masked CIF, trade and obra. */
export function filterCompanies(companies: SubcontractorListItem[], filter: CompanyFilter) {
  const query = filter.query.trim().toLowerCase();
  return companies.filter(
    (c) =>
      // A material supplier has no CAE status: only under "all".
      (filter.status === "all" || (!c.suppliesOnly && c.status === filter.status)) &&
      (!query || c.legalName.toLowerCase().includes(query) || c.taxIdMasked.toLowerCase().includes(query)) &&
      (!filter.trade || c.trades.includes(filter.trade)) &&
      (!filter.projectId || c.projectIds.includes(filter.projectId)),
  );
}

const STATUSES = ["all", "apta", "pendiente", "bloqueada"] as const;

/** Presentational: the register of companies with its filters. */
export default function CompaniesTable({
  companies,
  projects,
  filter,
  onFilterChange,
}: {
  companies: SubcontractorListItem[];
  projects: ProjectOption[];
  filter: CompanyFilter;
  onFilterChange: (filter: CompanyFilter) => void;
}) {
  const t = useTranslations("subcontractors.companies");
  const ts = useTranslations("subcontractors");
  const trades = [...new Set(companies.flatMap((c) => c.trades))].sort();
  // Chips count everything else the filter keeps.
  const counted = filterCompanies(companies, { ...filter, status: "all" });
  const rows = filterCompanies(companies, filter);
  const set = (patch: Partial<CompanyFilter>) => onFilterChange({ ...filter, ...patch });
  const status = (c: SubcontractorListItem) =>
    c.suppliesOnly ? (
      <Badge className="rounded-[9px] whitespace-normal">{ts("fields.types.supplier.label")}</Badge>
    ) : (
      <CompanyStatusBadge status={c.status} />
    );

  return (
    <section className={cardVariants()} aria-labelledby="companies-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="companies-title">{t("table.title")}</h2>
        <span className="text-meta text-muted-foreground">{t("table.hint")}</span>
      </div>
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filters.status")}>
          {STATUSES.map((status) => (
            <ToggleChip key={status} tone="solid" on={filter.status === status} onToggle={() => set({ status })}>
              {t(`filters.${status}`)}
              <span className="num text-xs">
                {status === "all" ? counted.length : counted.filter((c) => !c.suppliesOnly && c.status === status).length}
              </span>
            </ToggleChip>
          ))}
        </div>
        <label className="flex min-h-9 min-w-0 flex-[1_1_200px] items-center gap-2 rounded-md border bg-raise px-2.5 text-muted-foreground pointer-coarse:min-h-11">
          <Search aria-hidden className="size-4 flex-none" />
          <input
            type="search"
            value={filter.query}
            onChange={(e) => set({ query: e.target.value })}
            placeholder={t("filters.search")}
            aria-label={t("filters.search")}
            className="w-full min-w-0 bg-transparent text-sm text-foreground outline-none"
          />
        </label>
        <NativeSelect
          className="w-auto min-w-44"
          aria-label={t("filters.trade")}
          value={filter.trade}
          onChange={(e) => set({ trade: e.target.value })}
        >
          <NativeSelectOption value="">{t("filters.allTrades")}</NativeSelectOption>
          {trades.map((trade) => (
            <NativeSelectOption key={trade} value={trade}>
              {ts(`trades.${trade}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <NativeSelect
          className="w-auto min-w-44"
          aria-label={t("filters.project")}
          value={filter.projectId}
          onChange={(e) => set({ projectId: e.target.value })}
        >
          <NativeSelectOption value="">{t("filters.allProjects")}</NativeSelectOption>
          {projects.map((p) => (
            <NativeSelectOption key={p.id} value={p.id}>
              {p.ref}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {companies.length === 0 ? t("table.none") : t("table.empty")}
        </p>
      ) : (
        <>
        {/* Phones: one card per company, opening its ficha. */}
        <ul className="m-0 flex list-none flex-col p-0 md:hidden">
          {rows.map((c) => (
            <li key={c.id} className="relative flex flex-col gap-1.5 border-t py-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Link href={companyHref(c.id)} className={cn("font-semibold hover:text-primary", stretchedLink)}>
                  {c.legalName}
                </Link>
                {status(c)}
              </div>
              <div className="text-meta text-muted-foreground">
                <span className="num">{c.taxIdMasked}</span> · {t("table.reaIn", { region: ts(`regions.${c.reaRegion}`) })}
              </div>
              <div className="text-sm">
                {c.trades.map((trade) => ts(`trades.${trade}`)).join(" · ") || "—"}
                <span className="text-muted-foreground"> · {ts(`fields.types.${companyType(c)}.label`)}</span>
              </div>
              {!c.suppliesOnly && (
                <dl className="m-0 mt-1 flex flex-wrap gap-x-3 gap-y-1.5">
                  {DOC_PILLARS.map((pillar) => (
                    <div key={pillar} className="flex items-center gap-1.5">
                      <dt className="text-meta text-muted-foreground">{t(`table.${pillar}`)}</dt>
                      <dd className="m-0">
                        <DocStateBadge state={c.pillars[pillar].state} daysLeft={c.pillars[pillar].daysLeft} short />
                      </dd>
                    </div>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <dt className="text-meta text-muted-foreground">{t("table.docs")}</dt>
                    <dd className="num m-0 text-sm">
                      {c.docsValid}/{c.docsTotal}
                    </dd>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <dt className="text-meta text-muted-foreground">{t("table.workers")}</dt>
                    <dd className="num m-0 text-sm">{c.workers}</dd>
                  </div>
                </dl>
              )}
            </li>
          ))}
        </ul>
        <div className="hidden md:block">
        <Table className="min-w-[900px]">
          <TableHeader>
            <TableRow>
              <TableHead>{t("table.company")}</TableHead>
              <TableHead>{t("table.trade")}</TableHead>
              {DOC_PILLARS.map((pillar) => (
                <TableHead key={pillar} className="text-center">
                  {t(`table.${pillar}`)}
                </TableHead>
              ))}
              <TableHead className="text-center">{t("table.docs")}</TableHead>
              <TableHead className="text-center">{t("table.workers")}</TableHead>
              <TableHead>{t("table.status")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("table.open")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="whitespace-normal">
                  <Link href={companyHref(c.id)} className={cn("font-semibold hover:underline hover:underline-offset-3", touchLink)}>
                    {c.legalName}
                  </Link>
                  <div className="text-meta text-muted-foreground">
                    <span className="num">{c.taxIdMasked}</span> · {t("table.reaIn", { region: ts(`regions.${c.reaRegion}`) })}
                  </div>
                </TableCell>
                <TableCell className="min-w-28 whitespace-normal">
                  {c.trades.map((trade) => ts(`trades.${trade}`)).join(" · ") || "—"}
                  <div className="text-meta text-muted-foreground">
                    {ts(`fields.types.${companyType(c)}.label`)}
                  </div>
                </TableCell>
                {c.suppliesOnly ? (
                  <TableCell colSpan={DOC_PILLARS.length + 2} className="text-center text-meta text-muted-foreground">
                    {t("table.noCae")}
                  </TableCell>
                ) : (
                  <>
                    {DOC_PILLARS.map((pillar) => (
                      <TableCell key={pillar} className="text-center">
                        <DocStateBadge state={c.pillars[pillar].state} daysLeft={c.pillars[pillar].daysLeft} short />
                      </TableCell>
                    ))}
                    <TableCell className="text-center num">
                      {c.docsValid}/{c.docsTotal}
                    </TableCell>
                    <TableCell className="text-center num">{c.workers}</TableCell>
                  </>
                )}
                <TableCell>
                  {/* Wraps (as Oficio's "Proveedor de material" does) rather than widen the table past the card. */}
                  {status(c)}
                </TableCell>
                <TableCell>
                  <Link
                    href={companyHref(c.id)}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    aria-label={t("table.openFor", { name: c.legalName })}
                  >
                    {t("table.open")}
                    <ChevronRight aria-hidden />
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        </div>
        </>
      )}
    </section>
  );
}
