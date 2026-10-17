"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Download, Pencil } from "lucide-react";
import type { SubcontractorDetail } from "@repo/core/contract";
import { buttonVariants } from "@/components/ui/button";
import { CompanyStatusBadge } from "../Badges";
import { companyHref, dossierUrl } from "../display";

/** Presentational: the company's name, status and identity, with its actions. */
export default function CompanyHeader({ company }: { company: SubcontractorDetail }) {
  const t = useTranslations("subcontractors.company");
  const ts = useTranslations("subcontractors");
  const meta: [string, React.ReactNode][] = [
    [company.kind === "company" ? t("meta.taxId") : t("meta.nif"), <span key="tax" className="num">{company.taxId}</span>],
    [t("meta.trades"), company.trades.map((trade) => ts(`trades.${trade}`)).join(" · ") || "—"],
    [
      t("meta.rea"),
      <span key="rea">
        {company.reaNumber && <span className="num">{company.reaNumber} · </span>}
        {ts(`regions.${company.reaRegion}`)}
      </span>,
    ],
    [t("meta.kind"), ts(`kinds.${company.kind}`)],
  ];

  return (
    <header className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between">
      <div className="flex min-w-0 flex-col gap-2">
        <Link href="/dashboard/subcontratas/empresas" className="text-[12.5px] text-muted-foreground hover:text-foreground">
          {t("back")}
        </Link>
        <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
          <h1 className="[overflow-wrap:anywhere]">{company.legalName}</h1>
          <CompanyStatusBadge status={company.status.status} className="px-3 py-1 text-[13px]" />
        </div>
        <dl className="m-0 flex flex-wrap gap-x-5 gap-y-1 text-[13.5px]">
          {meta.map(([label, value]) => (
            <div key={label} className="flex gap-1.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="m-0">{value}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {/* The dossier holds CIFs and DNIs in full: admins and managers only. */}
        {company.canManage && (
          <a className={buttonVariants({ variant: "outline" })} href={dossierUrl({ subcontractorId: company.id })} download>
            <Download aria-hidden />
            {t("dossier")}
          </a>
        )}
        {company.canManage && (
          <Link className={buttonVariants({ variant: "outline" })} href={`${companyHref(company.id)}/editar`}>
            <Pencil aria-hidden />
            {t("edit")}
          </Link>
        )}
      </div>
    </header>
  );
}
