"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BudgetRevision, BudgetRevisionSummary } from "@repo/core/contract";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useObraFormat } from "../obra/format";
import Stepper, { type Step } from "../obra/Stepper";
import { BUDGET_TABS, budgetHref, TAB_PATH, type BudgetTab } from "./links";
import RevisionPill from "./RevisionPill";

/** The process as the stepper shows it, from the newest revision. */
function steps(newest: BudgetRevisionSummary, inputCount: number, t: ReturnType<typeof useTranslations<"budget">>, date: (d: string) => string): Step[] {
  const order = { draft: 1, issued: 2, rejected: 2, accepted: 3, superseded: 3 } as const;
  const at = order[newest.status];
  const state = (i: number): Step["state"] => (i < at ? "done" : i === at ? "current" : "todo");
  return [
    { key: "documents", label: t("steps.documents"), meta: t("steps.documentsMeta", { count: inputCount }), state: "done" },
    { key: "draft", label: t("steps.draft"), meta: t("steps.draftMeta", { number: newest.number }), state: state(1) },
    {
      key: "issued",
      label: t("steps.issued"),
      meta: newest.issuedOn ? t("steps.issuedOn", { date: date(newest.issuedOn) }) : t("steps.issuedMeta"),
      state: at === 3 ? "done" : state(2),
    },
    { key: "accepted", label: t("steps.accepted"), meta: t("steps.acceptedMeta"), state: at === 3 ? "done" : "todo" },
  ];
}

/**
 * Presentational: what every tab of the budget shares: title, status,
 * actions (`actions`, from the container), the process stepper, a banner for
 * where the revision stands, and the tabs.
 */
export default function BudgetFrame({
  projectId,
  projectRef,
  site,
  revision,
  revisions,
  tab,
  inputCount,
  saving,
  actions,
  banner,
  children,
}: {
  projectId: string;
  projectRef: string;
  site: string;
  revision: BudgetRevision;
  revisions: BudgetRevisionSummary[];
  tab: BudgetTab;
  inputCount: number;
  saving: boolean;
  actions: React.ReactNode;
  banner?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("budget");
  const f = useObraFormat();
  const newest = revisions[0]!;
  const viewingOld = newest.id !== revision.id;
  const revisionParam = viewingOld ? revision.id : null;
  const counts: Partial<Record<BudgetTab, number>> = { lines: revision.lineCount, options: revision.options.length, revisions: revisions.length };
  const summary = [
    revision.reference && t("summaryReference", { reference: revision.reference }),
    revision.texts.cover.promoter,
    revision.builtAreaM2 && t("summaryBuilt", { m2: f.quantity(revision.builtAreaM2) }),
  ].filter(Boolean);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:justify-between">
        <div className="min-w-0">
          <p className="eyebrow">{[projectRef, site].filter(Boolean).join(" · ")}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h1>{t("title")}</h1>
            <RevisionPill number={revision.number} status={revision.status} />
          </div>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {summary.join(" · ")}
            {revision.status === "draft" && (
              <span className={cn("ml-2", saving ? "text-muted-foreground" : "text-good")} aria-live="polite">
                {saving ? t("saving") : `✓ ${t("saved")}`}
              </span>
            )}
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          {(["general", "detailed"] as const).map((kind) => (
            <Link key={kind} href={budgetHref(projectId, "/pdf", revisionParam, { kind })} className={buttonVariants({ variant: "outline" })}>
              <FileText aria-hidden />
              {t(kind === "general" ? "pdfGeneral" : "pdfDetailed")}
            </Link>
          ))}
          {actions}
        </div>
      </header>

      <div className="rounded-[14px] border bg-card px-4 py-3 shadow-card">
        <Stepper label={t("steps.label")} steps={steps(newest, inputCount, t, f.date)} />
      </div>

      {viewingOld && (
        <p className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border bg-raise px-4 py-2.5 text-[13.5px]">
          {t("viewingOld", { number: revision.number, status: t(`status.${revision.status}`) })}
          <Link href={budgetHref(projectId, TAB_PATH[tab])} className="font-semibold text-brand-ink hover:underline">
            {t("viewLatest")}
          </Link>
        </p>
      )}
      {banner}

      <nav aria-label={t("tabs.label")} className="-mx-1 flex gap-0.5 overflow-x-auto border-b px-1">
        {BUDGET_TABS.map((key) => (
          <Link
            key={key}
            href={budgetHref(projectId, TAB_PATH[key], revisionParam)}
            aria-current={key === tab ? "page" : undefined}
            className={cn(
              "-mb-px inline-flex min-h-11 items-center gap-1.5 border-b-2 border-transparent px-3.5 text-sm font-semibold whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
              key === tab && "border-primary text-foreground",
            )}
          >
            {t(`tabs.${key}`)}
            {counts[key] !== undefined && (
              <span className="rounded-full bg-raise px-1.5 font-mono text-[11px] text-muted-foreground">{counts[key]}</span>
            )}
          </Link>
        ))}
      </nav>

      {children}
    </div>
  );
}
