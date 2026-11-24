"use client";

// Container for Obra › Resumen: the only part of it that knows about server
// actions. The views in ../components/construction take props only.

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import type { ConstructionControl } from "@repo/core/contract";
import { reviewChangesAction } from "../../../../actions/construction";
import EmptyState from "../components/EmptyState";
import { SleepingCamera } from "../components/illustrations";
import { textLink } from "../components/obra/classes";
import { useObraAction } from "../components/obra/useObraAction";
import { PeriodFilter, ReadOnlyNote } from "../components/construction/Filters";
import { useControlFormat } from "../components/construction/format";
import SummaryFigures from "../components/construction/SummaryFigures";
import ObraFrame, { chapterHref, obraHref, type ObraHeader } from "../components/construction/ObraFrame";
import LateDeliveriesBanner from "../components/construction/LateDeliveriesBanner";
import ReviewBanner from "../components/construction/ReviewBanner";
import { orderHref } from "../components/purchasing/links";
import { inPeriod } from "../components/construction/schedule";
import { DocumentAlertsCard, NextMilestoneCard, OpenIssuesCard } from "../components/construction/SummaryCards";
import SummaryTable from "../components/construction/SummaryTable";

/** Moved after the chapters below 768px (the page is a flex column). */
const phoneLater = "max-md:order-1";

/** The works at a glance: budget, cost and global value, the chapters (filtered by period here), the next hito, issues, documents. */
export default function SummaryScreen({
  projectId,
  header,
  control,
  canManage,
}: {
  projectId: string;
  header: ObraHeader;
  control: ConstructionControl;
  canManage: boolean;
}) {
  const t = useTranslations("construction.summary");
  const tf = useTranslations("construction.filters");
  const f = useControlFormat();
  const { state: reviewState, pending: reviewing, run } = useObraAction();
  const { project, budget, chapters, today } = control;
  const [period, setPeriod] = useState({ from: project.startDate ?? "", to: project.completionDate ?? "" });

  const shown = chapters.filter((c) => inPeriod(c, today, period.from, period.to));

  const facts = [
    { label: t("client"), value: project.clientName ?? "—" },
    { label: t("plannedStart"), value: f.date(project.startDate), num: true },
    { label: t("plannedEnd"), value: f.date(project.completionDate), num: true },
    {
      label: t("budget"),
      value: budget ? t("budgetValue", { reference: budget.reference ?? t("noReference"), number: budget.number }) : "—",
    },
  ];

  return (
    <ObraFrame
      projectId={projectId}
      header={header}
      current="summary"
      title={t("title")}
      description={project.address}
      aside={
        <dl className="m-0 grid grid-cols-2 gap-x-7 gap-y-3 text-sm sm:grid-cols-4">
          {facts.map((fact) => (
            <div key={fact.label} className="flex flex-col gap-1">
              <dt className="eyebrow">{fact.label}</dt>
              <dd className={fact.num ? "num m-0" : "m-0 font-semibold"}>{fact.value}</dd>
            </div>
          ))}
        </dl>
      }
    >
      {!budget ? (
        <EmptyState
          illustration={<SleepingCamera />}
          title={t("noBudgetTitle")}
          text={t("noBudgetText")}
          action={
            <Link href={`/dashboard/projects/${projectId}/budget`} className={textLink}>
              {t("goToBudget")}
            </Link>
          }
        />
      ) : (
        <>
          {control.reviewPending && (
            <ReviewBanner
              added={chapters.filter((c) => c.added)}
              removed={control.removedChapters}
              onReviewed={canManage ? () => run(() => reviewChangesAction(projectId)) : undefined}
              pending={reviewing}
              error={reviewState?.error}
            />
          )}

          <LateDeliveriesBanner orders={control.lateDeliveries} orderHref={(id) => orderHref(projectId, id)} />

          <form aria-label={tf("label")} className="flex flex-wrap items-center gap-x-3.5 gap-y-2.5" onSubmit={(e) => e.preventDefault()}>
            <PeriodFilter from={period.from} to={period.to} onChange={setPeriod} />
            <ReadOnlyNote className="md:ml-auto" />
          </form>

          {/* On a phone the chapters come first, under the filters that pick them; the key figures follow. */}
          <SummaryFigures control={control} className={phoneLater} />

          <SummaryTable
            chapters={shown}
            control={control}
            chapterHref={(code) => chapterHref(projectId, code)}
            progressHref={obraHref(projectId, "planning")}
          />

          <div className={cn("grid grid-cols-[repeat(auto-fit,minmax(min(300px,100%),1fr))] gap-3.5", phoneLater)}>
            <NextMilestoneCard milestones={control.milestones} href={obraHref(projectId, "milestones")} />
            <OpenIssuesCard issues={control.issues} href={obraHref(projectId, "issues")} />
            <DocumentAlertsCard items={control.documentAlerts} subcontractorsHref="/dashboard/subcontratas/empresas" />
          </div>
        </>
      )}
    </ObraFrame>
  );
}
