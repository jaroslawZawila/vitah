"use client";

import { useTranslations } from "next-intl";
import type { SubcontractorsOverview } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import Kpi from "../../../projects/[id]/components/obra/Kpi";

/** Presentational: the four key figures of the Empresas page. */
export default function CompaniesKpis({
  overview,
}: {
  overview: Pick<SubcontractorsOverview, "counts" | "workers" | "expiring" | "expired" | "onSiteToday">;
}) {
  const t = useTranslations("subcontractors.companies.kpis");
  const { counts, workers, expiring, expired, onSiteToday } = overview;
  const companies = counts.apta + counts.pendiente + counts.bloqueada;

  return (
    <section aria-label={t("label")} className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 xl:grid-cols-4">
      <Kpi
        label={t("companies")}
        value={companies}
        hints={[
          <span key="pills" className="mt-1 flex flex-wrap gap-1.5">
            <Badge variant="good">{t("apta", { count: counts.apta })}</Badge>
            <Badge variant="yel">{t("pendiente", { count: counts.pendiente })}</Badge>
            <Badge variant="destructive">{t("bloqueada", { count: counts.bloqueada })}</Badge>
          </span>,
        ]}
      />
      <Kpi
        label={t("workersWithAccess")}
        value={
          <>
            {workers.ok} <small>/ {workers.total}</small>
          </>
        }
        hints={[t("workersDetail", { pending: workers.pending, blocked: workers.blocked })]}
      />
      <Kpi
        label={t("expiring")}
        value={<span className={expiring > 0 ? "text-warn" : undefined}>{expiring}</span>}
        hints={[
          expired > 0 ? (
            <Badge key="expired" variant="destructive" className="mt-1">
              {t("expired", { count: expired })}
            </Badge>
          ) : (
            t("noneExpired")
          ),
        ]}
      />
      <Kpi
        highlight
        label={
          onSiteToday.projectRefs.length > 0 ? t("onSiteRefs", { refs: onSiteToday.projectRefs.join(", ") }) : t("onSite")
        }
        value={
          <>
            {onSiteToday.companies} <small>{t("companiesUnit", { count: onSiteToday.companies })}</small> ·{" "}
            {onSiteToday.workers} <small>{t("workersUnit", { count: onSiteToday.workers })}</small>
          </>
        }
        hints={
          onSiteToday.blocked.length > 0
            ? [
                <span key="blocked" className="text-bad">
                  {t("blocked", { names: onSiteToday.blocked.join(", ") })}
                </span>,
              ]
            : onSiteToday.projectRefs.length === 0
              ? [t("noneOnSite")]
              : []
        }
      />
    </section>
  );
}
