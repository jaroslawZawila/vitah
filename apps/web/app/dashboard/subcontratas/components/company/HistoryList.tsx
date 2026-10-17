"use client";

import { useTranslations } from "next-intl";
import type { SubcontractorAuditEntry, SubcontractorKind } from "@repo/core/contract";
import { cardVariants } from "@/components/ui/card";
import { useDates, useRequirementName } from "../display";

const KNOWN = new Set([
  "created",
  "updated",
  "document_uploaded",
  "document_validated",
  "document_rejected",
  "document_not_applicable",
  "document_requested",
  "document_reminded",
  "document_expired",
  "assigned",
  "unassigned",
  "worker_created",
  "worker_updated",
]);

/** An audit entry in words. */
export function useAuditText() {
  const t = useTranslations("subcontractors");
  const name = useRequirementName();
  return (entry: SubcontractorAuditEntry, kind: SubcontractorKind) => {
    if (!KNOWN.has(entry.action)) return entry.action;
    const d = entry.detail;
    const text = (key: string) => (typeof d[key] === "string" || typeof d[key] === "number" ? String(d[key]) : "");
    const fields =
      d.fields && typeof d.fields === "object"
        ? Object.keys(d.fields)
            .map((field) => (t.has(`fieldNames.${field}`) ? t(`fieldNames.${field}`) : field))
            .join(", ")
        : "";
    return t(`audit.${entry.action}`, {
      document: typeof d.requirementId === "string" ? name(d.requirementId, kind) : "",
      version: text("version"),
      reason: text("reason"),
      fields,
      project: text("projectRef"),
      name: text("name"),
      count: typeof d.affectedWorkers === "number" ? d.affectedWorkers : 0,
    });
  };
}

/** Presentational: the company's audit log, newest first. */
export default function HistoryList({
  entries,
  kind,
}: {
  entries: SubcontractorAuditEntry[];
  kind: SubcontractorKind;
}) {
  const t = useTranslations("subcontractors");
  const { dateTime } = useDates();
  const text = useAuditText();

  return (
    <section className={cardVariants()} aria-labelledby="history-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="history-title">{t("company.history.title")}</h2>
        <span className="text-[12.5px] text-muted-foreground">{t("company.history.hint")}</span>
      </div>
      {entries.length === 0 ? (
        <p className="py-6 text-center text-[13.5px] text-muted-foreground">{t("company.history.empty")}</p>
      ) : (
        <ol className="m-0 flex list-none flex-col p-0">
          {entries.map((entry) => (
            <li key={entry.id} className="flex flex-col gap-0.5 border-t py-3 first:border-t-0 first:pt-0 sm:flex-row sm:gap-3.5">
              <time dateTime={entry.at} className="num flex-none pt-0.5 text-[12px] text-muted-foreground sm:w-[140px]">
                {dateTime(entry.at)}
              </time>
              <div className="min-w-0 text-[13.5px]">
                {text(entry, kind)}
                <div className="text-[12.5px] text-muted-foreground">
                  {entry.userName ?? t("audit.system")}
                  {entry.workerName && ` · ${t("company.history.worker", { name: entry.workerName })}`}
                </div>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
