"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Upload } from "lucide-react";
import type { AttentionItem, ControlMilestone, ObraIssue, ProjectPhoto } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DOC_STATE_VARIANT, useDates, useRequirementName } from "../../../../subcontratas/components/display";
import { cardTop, footnote, kv, moreLink } from "./classes";
import { useControlFormat } from "./format";
import { IssueKindPill, MilestoneStatePill, Source, SourceLabel } from "./pills";

// Presentational: the Resumen's cards under the chapters table.

/** "INC-007" / "CAM-004". */
export function useIssueRef() {
  const t = useTranslations("construction.issueRef");
  return (issue: Pick<ObraIssue, "kind" | "number">) => t(issue.kind, { number: String(issue.number).padStart(3, "0") });
}

/** An issue's estimated impact: "+2.350 € est.", "+3 d est.", or null. */
export function useImpact() {
  const t = useTranslations("construction.issues");
  const f = useControlFormat();
  return {
    cost: (issue: ObraIssue) =>
      issue.costImpactCents === null ? null : t("estimated", { value: `${f.signedEuros(issue.costImpactCents)} €` }),
    days: (issue: ObraIssue) =>
      issue.scheduleImpactDays === null ? null : t("estimated", { value: f.signedDays(issue.scheduleImpactDays) }),
  };
}

export function MilestonesCard({ milestones, href }: { milestones: ControlMilestone[]; href: string }) {
  const t = useTranslations("construction.summary.milestones");
  const ts = useTranslations("construction.sources");
  return (
    <section className={cn(cardVariants(), "gap-2.5")} aria-labelledby="summary-milestones">
      <div className={cardTop}>
        <h2 id="summary-milestones">{t("title")}</h2>
        <Link href={href} className={moreLink}>
          {t("more")} →
        </Link>
      </div>
      {milestones.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col p-0">
          {milestones.map((m) => {
            const done = m.chapters.filter((c) => c.state === "finished").length;
            return (
              <li key={m.id} className={kv}>
                <span className="min-w-0">
                  <span className="num font-semibold">{m.code}</span> {m.name}
                  {m.state === "pending" && done > 0 && (
                    <span className="text-muted-foreground"> · {t("chaptersDone", { done, total: m.chapters.length })}</span>
                  )}
                </span>
                <MilestoneStatePill state={m.state} />
              </li>
            );
          })}
        </ul>
      )}
      <SourceLabel>
        {t("amounts")} <Source name={ts("budget")} /> · {t("invoices")} <Source name={ts("sales")} />
      </SourceLabel>
    </section>
  );
}

export function OpenIssuesCard({ issues, href }: { issues: ObraIssue[]; href: string }) {
  const t = useTranslations("construction.summary.issues");
  const ts = useTranslations("construction.issueStatus");
  const impact = useImpact();
  return (
    <section className={cn(cardVariants(), "gap-2.5")} aria-labelledby="summary-issues">
      <div className={cardTop}>
        <h2 id="summary-issues">{t("title")}</h2>
        <Link href={href} className={moreLink}>
          {t("more")} →
        </Link>
      </div>
      {issues.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {issues.slice(0, 5).map((issue) => (
            <li key={issue.id} className="flex items-start gap-2.5">
              <IssueKindPill kind={issue.kind} />
              <span className="text-[13px] leading-snug">
                <span className="num">{issue.chapterCode}</span> · {issue.description}{" "}
                <span className="text-muted-foreground">
                  · {ts(issue.status).toLowerCase()}
                  {(impact.cost(issue) ?? impact.days(issue)) && ` · ${impact.cost(issue) ?? impact.days(issue)}`}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const DOT_TONE: Record<string, string> = {
  destructive: "text-bad",
  warn: "text-warn",
  yel: "text-yel",
  info: "text-info",
  good: "text-good",
  outline: "text-muted-foreground",
};

/** Subcontractor documents of this obra that need doing (read-only: Administration updates them). */
export function DocumentAlertsCard({ items, subcontractorsHref }: { items: AttentionItem[]; subcontractorsHref: string }) {
  const t = useTranslations("construction.summary.documents");
  const ta = useTranslations("subcontractors.companies.attention");
  const td = useTranslations("subcontractors.docState");
  const name = useRequirementName();
  const { date } = useDates();
  const missing = items.filter((i) => ["missing", "requested", "rejected"].includes(i.state)).length;
  const expiring = items.filter((i) => i.state === "expiring" || i.state === "expired").length;
  const toValidate = items.filter((i) => i.state === "uploaded").length;
  const summary = [
    missing && t("missing", { count: missing }),
    expiring && t("expiring", { count: expiring }),
    toValidate && t("toValidate", { count: toValidate }),
  ].filter(Boolean);

  function what(item: AttentionItem) {
    const title =
      item.requirementIds.length > 1
        ? ta("missingDocs", { count: item.requirementIds.length })
        : name(item.requirementIds[0]!);
    const when =
      item.date && item.state === "expiring"
        ? ta("expiresOn", { date: date(item.date) })
        : item.date && item.state === "expired"
          ? ta("expiredOn", { date: date(item.date) })
          : td(item.state).toLowerCase();
    return `${title} · ${when}`;
  }

  return (
    <section className={cn(cardVariants(), "gap-2.5")} aria-labelledby="summary-documents">
      <div className={cardTop}>
        <h2 id="summary-documents">{t("title")}</h2>
        {summary.length > 0 ? <Badge variant="destructive">{summary.join(" · ")}</Badge> : <Badge variant="good">{t("ok")}</Badge>}
      </div>
      {items.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[13px] leading-snug">
          {items.slice(0, 6).map((item) => (
            <li key={`${item.documentId ?? item.subcontractorId}|${item.requirementIds.join(",")}`} className="flex gap-2.5">
              <span aria-hidden className={cn("font-bold", DOT_TONE[DOC_STATE_VARIANT[item.state]])}>
                ●
              </span>
              <span>
                <b>{item.subcontractorName}</b>
                {item.workerName && ` · ${item.workerName}`} · {what(item)}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className={footnote}>
        {t.rich("note", {
          link: (chunks) => (
            <Link href={subcontractorsHref} className="font-semibold text-brand-ink hover:text-primary">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </section>
  );
}

export function RecentPhotosCard({
  photos,
  count,
  href,
  thumbUrl,
  chapterName,
  canUpload,
}: {
  photos: ProjectPhoto[];
  count: number;
  href: string;
  thumbUrl: (photo: ProjectPhoto) => string;
  chapterName: (code: string) => string | undefined;
  canUpload: boolean;
}) {
  const t = useTranslations("construction.summary.photos");
  const f = useControlFormat();
  return (
    <section className={cn(cardVariants(), "gap-3")} aria-labelledby="summary-photos">
      <div className={cardTop}>
        <h2 id="summary-photos">{t("title")}</h2>
        <div className="flex flex-wrap items-center gap-2">
          {count > 0 && (
            <Link href={href} className={moreLink}>
              {t("seeAll", { count })} →
            </Link>
          )}
          {canUpload && (
            <Link href={href} className={buttonVariants()}>
              <Upload aria-hidden />
              {t("upload")}
            </Link>
          )}
        </div>
      </div>
      {photos.length === 0 ? (
        <p className="text-[13px] text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0 sm:grid-cols-3">
          {photos.map((photo) => {
            const caption = [f.day(photo.takenOn), photo.chapterCode, photo.caption ?? (photo.chapterCode && chapterName(photo.chapterCode))]
              .filter(Boolean)
              .join(" · ");
            return (
              <li key={photo.id} className="flex min-w-0 flex-col gap-1">
                {/* Served by our authenticated API, so next/image can't optimise it. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbUrl(photo)} alt={caption} loading="lazy" className="aspect-[4/3] w-full rounded-lg bg-raise object-cover" />
                <span className="truncate text-[11.5px] text-muted-foreground">{caption}</span>
              </li>
            );
          })}
        </ul>
      )}
      <p className={footnote}>{t("note")}</p>
    </section>
  );
}
