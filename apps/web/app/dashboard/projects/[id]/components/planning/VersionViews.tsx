"use client";

import { useTranslations } from "next-intl";
import type { PlanningStatus, PlanningVersions } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { muted } from "../obra/classes";
import { daysBetween, useControlFormat } from "../construction/format";

// Presentational: Obra › Planificación › Versiones, every version with its
// reason, and what one moved against the version before it.

type Version = PlanningVersions["versions"][number];

const STATUS_TONE: Record<PlanningStatus, "yel" | "good" | "outline"> = { draft: "yel", approved: "good", superseded: "outline" };

/** The versions, newest first; picking one compares it with the one before. */
export function VersionList({ versions, picked, onPick }: { versions: Version[]; picked: string; onPick: (id: string) => void }) {
  const t = useTranslations("planning.versions");
  const f = useControlFormat();
  return (
    <ol className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label={t("listLabel")}>
      {versions.map((v) => (
        <li key={v.id}>
          <button
            type="button"
            aria-pressed={v.id === picked}
            onClick={() => onPick(v.id)}
            className={cn(
              cardVariants(),
              "w-full cursor-pointer gap-1.5 text-left transition-colors hover:border-foreground/30 aria-pressed:border-primary aria-pressed:ring-1 aria-pressed:ring-primary",
            )}
          >
            <span className="flex w-full flex-wrap items-center justify-between gap-2">
              <span className="font-heading text-[22px] font-semibold">
                {v.status === "draft" ? t("draft", { number: v.number }) : t("baseline", { number: v.number })}
              </span>
              <Badge variant={STATUS_TONE[v.status]}>{t(`status.${v.status}`)}</Badge>
            </span>
            {v.reason && <span className="text-[13px] leading-snug">«{v.reason}»</span>}
            <span className={muted}>
              {v.approvedAt
                ? t("approvedBy", { name: v.approvedBy ?? "—", date: f.stampDay(v.approvedAt) })
                : t("createdBy", { name: v.createdBy ?? "—", date: f.stampDay(v.createdAt) })}
              {" · "}
              {t("end", { date: f.fullDay(v.endDate) })}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/** What `version` moved against `previous`: the chapters whose dates changed, and the end. */
export function VersionCompare({ version, previous }: { version: Version; previous: Version | null }) {
  const t = useTranslations("planning.versions");
  const f = useControlFormat();
  const before = new Map(previous?.rows.map((r) => [r.code, r]) ?? []);
  const changes = previous
    ? version.rows.filter((r) => {
        const old = before.get(r.code);
        return !old || old.plannedStart !== r.plannedStart || old.plannedEnd !== r.plannedEnd;
      })
    : [];
  const endDelta = previous ? daysBetween(previous.endDate, version.endDate) : 0;

  return (
    <section className={cn(cardVariants({ size: "flush" }), "min-w-0 py-4")} aria-labelledby="compare-title">
      <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2 px-[18px] pb-3">
        <div>
          <h2 id="compare-title">
            {previous ? t("compareTitle", { number: version.number, previous: previous.number }) : t("firstTitle", { number: version.number })}
          </h2>
          <p className={muted}>{previous ? t("changed", { count: changes.length }) : t("first")}</p>
        </div>
        {previous && (
          <p className="num m-0 flex items-baseline gap-2">
            <span className="text-muted-foreground">{f.fullDay(previous.endDate)}</span>
            <span aria-hidden className="text-muted-foreground">→</span>
            <span className="text-[17px] font-semibold">{f.fullDay(version.endDate)}</span>
            {endDelta !== 0 && <span className={cn("font-semibold", endDelta > 0 ? "text-warn" : "text-good")}>{f.signedDays(endDelta)}</span>}
          </p>
        )}
      </div>
      {previous && changes.length > 0 && (
        <Table className="min-w-[560px] text-[13px]">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-[18px]">{t("code")}</TableHead>
              <TableHead>{t("chapter")}</TableHead>
              <TableHead>{t("version", { number: previous.number })}</TableHead>
              <TableHead>{t("version", { number: version.number })}</TableHead>
              <TableHead className="pr-[18px] text-right">{t("endChange")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {changes.map((row) => {
              const old = before.get(row.code);
              const delta = old ? daysBetween(old.plannedEnd, row.plannedEnd) : null;
              return (
                <TableRow key={row.code}>
                  <TableCell className="num pl-[18px]">{row.code}</TableCell>
                  <TableCell className="whitespace-normal">{row.name}</TableCell>
                  <TableCell className="num text-muted-foreground">{old ? `${f.day(old.plannedStart)} – ${f.day(old.plannedEnd)}` : "—"}</TableCell>
                  <TableCell className="num">
                    {f.day(row.plannedStart)} – {f.day(row.plannedEnd)}
                  </TableCell>
                  <TableCell
                    className={cn(
                      "num pr-[18px] text-right font-semibold",
                      delta === null || delta === 0 ? "text-muted-foreground" : delta > 0 ? "text-warn" : "text-good",
                    )}
                  >
                    {delta === null ? t("added") : delta === 0 ? t("same") : f.signedDays(delta)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
      <p className={cn(muted, "mx-[18px] mt-2.5")}>{previous ? t("unchanged") : t("firstNote")}</p>
    </section>
  );
}
