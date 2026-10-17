"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Download, Plus } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/** Presentational: the Empresas page heading and its actions. */
export default function CompaniesHeader({ dossierHref, canManage }: { dossierHref: string; canManage: boolean }) {
  const t = useTranslations("subcontractors.companies");
  return (
    <header className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between">
      <div className="min-w-0">
        <p className="eyebrow">{t("eyebrow")}</p>
        <h1 className="mt-1">{t("title")}</h1>
        <p className="mt-1.5 text-[13px] text-muted-foreground">{t("intro")}</p>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        {canManage && (
          <a className={buttonVariants({ variant: "outline" })} href={dossierHref} download>
            <Download aria-hidden />
            {t("exportDossier")}
          </a>
        )}
        {canManage && (
          <Link className={buttonVariants()} href="/dashboard/subcontratas/empresas/nueva">
            <Plus aria-hidden />
            {t("register")}
          </Link>
        )}
      </div>
    </header>
  );
}
