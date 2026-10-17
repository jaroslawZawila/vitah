"use client";

import { useTranslations } from "next-intl";
import { MANDATORY_COMPANY_REQUIREMENTS, type SubcontractorDetail } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { useDates } from "../display";

function Rows({ rows }: { rows: [string, React.ReactNode][] }) {
  return (
    <dl className="m-0 grid grid-cols-[minmax(110px,40%)_1fr] gap-x-3.5 gap-y-2.5 text-[13.5px]">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{value ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Presentational: the company's details, activity and documentation at a glance. */
export default function SummaryTab({ company }: { company: SubcontractorDetail }) {
  const t = useTranslations("subcontractors.company.summary");
  const ts = useTranslations("subcontractors");
  const { date } = useDates();
  const total = MANDATORY_COMPANY_REQUIREMENTS.length;
  const { expired, pending } = company.status;
  const valid = total - expired.length - pending.length;
  const share =
    company.headcount && company.permanentCount !== null
      ? Math.round((company.permanentCount / company.headcount) * 100)
      : null;

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <section className={cardVariants()}>
        <h2>{t("data")}</h2>
        <Rows
          rows={[
            [t("legalName"), company.legalName],
            [company.kind === "company" ? ts("company.meta.taxId") : ts("company.meta.nif"), <span key="tax" className="num">{company.taxId}</span>],
            [t("address"), `${company.address}, ${company.postalCode} ${company.city} (${company.province})`],
            [t("region"), ts(`regions.${company.reaRegion}`)],
            [t("reaNumber"), company.reaNumber && <span className="num">{company.reaNumber}</span>],
            [t("phone"), company.phone && <span className="num">{company.phone}</span>],
            [t("email"), company.email],
            [t("legalRep"), company.legalRep],
            [
              t("siteContact"),
              company.siteContact &&
                [company.siteContact, company.siteContactPhone].filter(Boolean).join(" · "),
            ],
          ]}
        />
      </section>
      <section className={cardVariants()}>
        <h2>{t("activity")}</h2>
        <Rows
          rows={[
            [
              t("trades"),
              company.trades.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {company.trades.map((trade) => (
                    <Badge key={trade} variant="outline">
                      {ts(`trades.${trade}`)}
                    </Badge>
                  ))}
                </div>
              ),
            ],
            [
              t("installer"),
              company.isInstaller ? (
                <>
                  {t("yes")}
                  {company.installerReg && <span className="num"> · {company.installerReg}</span>}
                </>
              ) : (
                t("no")
              ),
            ],
            [
              t("headcount"),
              company.headcount !== null && (
                <span className="flex flex-wrap items-center gap-1.5">
                  {t("headcountValue", { headcount: company.headcount, permanent: company.permanentCount ?? "—" })}
                  {share !== null && (
                    <Badge variant={company.lowPermanentShare ? "warn" : "good"}>{t("share", { share })}</Badge>
                  )}
                  {company.lowPermanentShare && (
                    <span className="text-[12.5px] text-warn">{t("lowShare")}</span>
                  )}
                </span>
              ),
            ],
            [
              t("subcontracts"),
              company.subcontractsFurther ? t("subcontractsYes", { level: company.chainLevel }) : `${t("no")} · ${t("level", { level: company.chainLevel })}`,
            ],
            [
              t("prevention"),
              company.preventionMode && (
                <>
                  {ts(`preventionModes.${company.preventionMode}.label`)}
                  {company.preventionEntity && ` · ${company.preventionEntity}`}
                  {company.preventionValidUntil && (
                    <div className="text-[12.5px] text-muted-foreground">
                      {t("preventionUntil", { date: date(company.preventionValidUntil) })}
                    </div>
                  )}
                </>
              ),
            ],
            [t("machinery"), company.machinery.map((m) => ts(`machinery.${m}`)).join(", ") || null],
          ]}
        />
      </section>
      <section className={cardVariants()}>
        <div className="flex items-center justify-between gap-2">
          <h2>{t("docs")}</h2>
          <span className="text-[12.5px] text-muted-foreground">{t("mandatory")}</span>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-heading text-[38px] leading-none font-bold tabular-nums">
            {valid} <span className="text-[22px] text-muted-foreground">/ {total}</span>
          </span>
          <span className="text-[12.5px] text-muted-foreground">{t("validCount")}</span>
        </div>
        <div
          className="flex h-2 overflow-hidden rounded-full bg-raise"
          role="img"
          aria-label={`${valid} / ${total}`}
        >
          <span className="bg-good" style={{ width: `${(valid / total) * 100}%` }} />
          <span className="bg-bad" style={{ width: `${(expired.length / total) * 100}%` }} />
          <span className="bg-yel" style={{ width: `${(pending.length / total) * 100}%` }} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="good">{t("valid", { count: valid })}</Badge>
          {expired.length > 0 && <Badge variant="destructive">{t("expired", { count: expired.length })}</Badge>}
          {pending.length > 0 && <Badge variant="yel">{t("pending", { count: pending.length })}</Badge>}
        </div>
      </section>
    </div>
  );
}
