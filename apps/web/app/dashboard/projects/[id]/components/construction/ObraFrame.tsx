"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ObraStage } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Dot } from "./pills";

/** The Obra tab's pages, in the order of its sub-navigation. */
export const OBRA_TABS = ["summary", "planning", "progress", "costs", "milestones", "issues", "photos"] as const;
export type ObraTab = (typeof OBRA_TABS)[number];

const TAB_PATH: Record<ObraTab, string> = {
  summary: "",
  planning: "/planificacion",
  progress: "/avance",
  costs: "/costes",
  milestones: "/hitos",
  issues: "/incidencias",
  photos: "/fotos",
};

export const obraHref = (projectId: string, tab: ObraTab = "summary") =>
  `/dashboard/projects/${projectId}/obra${TAB_PATH[tab]}`;

/** A chapter's page under Avance (codes are free text, so encoded). */
export const chapterHref = (projectId: string, code: string) =>
  `${obraHref(projectId, "progress")}/${encodeURIComponent(code)}`;

/** What every Obra page's header needs. */
export type ObraHeader = { ref: string; stage: ObraStage; openIssues: number };

/** Presentational: the project ref and its stage, as the Obra pages' eyebrow. */
export function StageEyebrow({ label, stage }: { label: string; stage?: ObraStage }) {
  const t = useTranslations("obra");
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      <span className="eyebrow text-brand-ink">{label}</span>
      {stage !== undefined && (
        <Badge>
          <Dot />
          {t("stagePill", { number: stage, name: t(`stages.${stage}`) })}
        </Badge>
      )}
    </div>
  );
}

/**
 * Presentational: an Obra page's header (ref and stage, title, what the page
 * is for, and its sources or actions on the right) above the sub-navigation
 * Resumen · Planificación · Avance · Costes · Hitos · Incidencias · Fotos.
 */
export default function ObraFrame({
  projectId,
  header,
  current,
  title,
  description,
  aside,
  children,
}: {
  projectId: string;
  header: ObraHeader;
  current: ObraTab;
  title: React.ReactNode;
  description?: React.ReactNode;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  const t = useTranslations("construction.tabs");

  return (
    <div className="flex flex-col gap-[18px]">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="min-w-0">
          <StageEyebrow label={header.ref} stage={header.stage} />
          <h1 className="mt-1.5">{title}</h1>
          {description && <div className="mt-1 max-w-[80ch] text-[14px] text-muted-foreground">{description}</div>}
        </div>
        {aside}
      </header>

      <nav aria-label={t("label")} className="-mx-1 flex gap-1 overflow-x-auto border-b px-1">
        {OBRA_TABS.map((tab) => {
          const on = tab === current;
          return (
            <Link
              key={tab}
              href={obraHref(projectId, tab)}
              aria-current={on ? "page" : undefined}
              className={cn(
                "-mb-px inline-flex min-h-11 flex-none items-center gap-[7px] border-b-2 border-transparent px-3.5 text-[14px] font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                on && "border-primary font-semibold text-foreground",
              )}
            >
              {t(tab)}
              {tab === "issues" && header.openIssues > 0 && (
                <span className="rounded-full bg-border px-[7px] py-px font-mono text-[11px] text-foreground/80">
                  {header.openIssues}
                  <span className="sr-only"> {t("openIssues", { count: header.openIssues })}</span>
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {children}
    </div>
  );
}
