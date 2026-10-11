"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { BudgetGeneration, BudgetRevision, BudgetRevisionSummary } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { cardHead, columns, muted, table } from "../obra/classes";
import { useObraFormat } from "../obra/format";
import RevisionPill from "./RevisionPill";
import SaveOnBlur from "./SaveOnBlur";

const CHAPTER_COLUMNS = "44px minmax(180px, 1fr) 120px 120px 120px";
const LINE_COLUMNS = "90px minmax(180px, 1fr) minmax(150px, auto) 110px";

/**
 * Presentational: every revision (what was issued never changes) and how the
 * one shown differs from the one before, with the reason for the change.
 */
export default function RevisionsView({
  revision,
  revisions,
  generation,
  viewHref,
  pdfHref,
  onReason,
}: {
  revision: BudgetRevision;
  revisions: BudgetRevisionSummary[];
  generation: BudgetGeneration | null;
  viewHref: (revisionId: string) => string;
  pdfHref: (revisionId: string, kind: "general" | "detailed") => string;
  onReason?: (reason: string) => void;
}) {
  const t = useTranslations("budget.revisions");
  const f = useObraFormat();
  const [showAll, setShowAll] = useState(false);
  const delta = (current: number, previous: number) => (
    <span className={cn(current > previous ? "text-warn" : current < previous ? "text-good" : "text-muted-foreground")}>{f.signedMoney(current - previous)}</span>
  );
  const chapters = revision.chapters.filter((c) => showAll || c.change !== null);
  const options = revision.options.filter((o) => showAll || o.change !== null);
  const unchanged = revision.chapters.length + revision.options.length - chapters.length - options.length;

  return (
    <div className="flex flex-col gap-4.5 lg:flex-row lg:items-start">
      <aside className={cn(cardVariants(), "gap-0 lg:w-[360px] lg:flex-none")} aria-labelledby="history-title">
        <span id="history-title" className="eyebrow pb-2.5">{t("history")}</span>
        <ol>
          {revisions.map((r, i) => {
            const previous = revisions[i + 1];
            const frozen = r.status !== "draft";
            return (
              <li key={r.id} className={cn("flex flex-col gap-1 border-t py-3.5 first:border-t-0", r.id === revision.id && "rounded-lg bg-raise px-2")}>
                <span className="flex items-center justify-between gap-2">
                  <b>Rev.{r.number}</b>
                  <RevisionPill number={r.number} status={r.status} />
                </span>
                <span className="num font-semibold">
                  {f.money(r.totalCents)} {previous && delta(r.totalCents, previous.totalCents)}
                </span>
                <span className={muted}>
                  {r.issuedOn ? t("issuedOn", { date: f.date(r.issuedOn) }) : t("draft")}
                  {r.acceptedAt && ` · ${t("acceptedOn", { date: f.date(r.acceptedAt.slice(0, 10)) })}`}
                </span>
                <span className="flex flex-wrap gap-1.5 pt-1">
                  {frozen && (["general", "detailed"] as const).map((kind) => (
                    <Link key={kind} href={pdfHref(r.id, kind)} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      {t(kind)}
                    </Link>
                  ))}
                  {r.id !== revision.id && (
                    <Link href={viewHref(r.id)} className={buttonVariants({ variant: "ghost", size: "sm" })}>{t("view")}</Link>
                  )}
                </span>
              </li>
            );
          })}
          {generation?.status === "succeeded" && (
            <li className="flex flex-col gap-0.5 border-t py-3.5">
              <b className="text-sm">{t("aiDraft")}</b>
              <span className={muted}>{t("aiDraftMeta", { date: f.date(generation.createdAt.slice(0, 10)) })}</span>
            </li>
          )}
        </ol>
        <p className={cn(muted, "mt-2 rounded-lg bg-raise px-3 py-2.5")}>{t("frozenNote")}</p>
      </aside>

      <section className={cn(cardVariants(), "min-w-0 flex-1")} aria-labelledby="compare-title">
        {revision.previous ? (
          <>
            <div className={cardHead}>
              <h2 id="compare-title">{t("compare", { number: revision.number, previous: revision.previous.number })}</h2>
              <span className="num text-[15px] font-semibold">
                {f.money(revision.previous.totalCents)} → {f.money(revision.totalCents)} {delta(revision.totalCents, revision.previous.totalCents)}
              </span>
            </div>
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
              <span>
                {t("reason")} <span className="font-normal text-muted-foreground">{t("reasonHint")}</span>
              </span>
              <SaveOnBlur key={revision.changeReason ?? ""} label={t("reason")} multiline rows={3} value={revision.changeReason ?? ""} onSave={onReason} />
            </label>

            <div role="table" aria-label={t("chapters")} className={table.root} style={columns(CHAPTER_COLUMNS)}>
              <div role="row" className={table.head}>
                <span role="columnheader">{t("code")}</span>
                <span role="columnheader">{t("chapters")}</span>
                <span role="columnheader" className={table.right}>Rev.{revision.previous.number}</span>
                <span role="columnheader" className={table.right}>Rev.{revision.number}</span>
                <span role="columnheader" className={table.right}>{t("difference")}</span>
              </div>
              {[...chapters, ...options].map((c) => (
                <div role="row" key={c.id} className={table.row}>
                  <span role="cell" className="num">{c.code}</span>
                  <span role="cell" className={table.name}>
                    {c.name} {c.change === "up" || c.change === "down" ? <Badge variant="default">{t("revised")}</Badge> : c.change === "new" ? <Badge variant="good">{t("new")}</Badge> : null}
                  </span>
                  <span role="cell" className={`num text-muted-foreground ${table.right}`}>{c.previousTotalCents === null ? "—" : f.money(c.previousTotalCents)}</span>
                  <span role="cell" className={`num ${table.right}`}>{f.money(c.totalCents)}</span>
                  <span role="cell" className={`num ${table.right}`}>{delta(c.totalCents, c.previousTotalCents ?? 0)}</span>
                </div>
              ))}
              <div role="row" className={table.total}>
                <span role="cell" />
                <span role="cell">{t("totalPec")}</span>
                <span role="cell" className={`num ${table.right}`}>{f.money(revision.previous.totalCents)}</span>
                <span role="cell" className={`num ${table.right}`}>{f.money(revision.totalCents)}</span>
                <span role="cell" className={`num ${table.right}`}>{delta(revision.totalCents, revision.previous.totalCents)}</span>
              </div>
            </div>
            {(unchanged > 0 || showAll) && (
              <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => setShowAll(!showAll)}>
                {showAll ? t("hideUnchanged") : t("showUnchanged", { count: unchanged })}
              </Button>
            )}

            {revision.lineChanges.length > 0 && (
              <div role="table" aria-label={t("lines")} className={table.root} style={columns(LINE_COLUMNS)}>
                <div role="row" className={table.head}>
                  <span role="columnheader">{t("line")}</span>
                  <span role="columnheader">{t("whatChanged")}</span>
                  <span role="columnheader">{t("beforeAfter")}</span>
                  <span role="columnheader" className={table.right}>{t("amount")}</span>
                </div>
                {revision.lineChanges.map((change) => {
                  const before = change.before?.amountCents ?? 0;
                  const after = change.after?.amountCents ?? 0;
                  return (
                    <div role="row" key={`${change.kind}-${change.code}`} className={table.row}>
                      <span role="cell" className="num text-muted-foreground">{change.code}</span>
                      <span role="cell" className={table.name}>
                        {change.description} {change.kind !== "changed" && <Badge variant={change.kind === "added" ? "good" : "destructive"}>{t(change.kind)}</Badge>}
                      </span>
                      <span role="cell" className="num text-muted-foreground">
                        {change.before && change.after
                          ? change.before.quantity !== change.after.quantity
                            ? `${f.quantity(change.before.quantity)} → ${f.quantity(change.after.quantity)}`
                            : `${f.decimal(change.before.unitPriceCents / 100)} → ${f.decimal(change.after.unitPriceCents / 100)}`
                          : "—"}
                      </span>
                      <span role="cell" className={`num ${table.right}`}>{delta(after, before)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        ) : (
          <>
            <h2 id="compare-title">{t("firstTitle")}</h2>
            <p className={muted}>{t("first")}</p>
          </>
        )}
      </section>
    </div>
  );
}
