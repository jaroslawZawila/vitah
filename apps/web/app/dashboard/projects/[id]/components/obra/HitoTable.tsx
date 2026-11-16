"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { Hito } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { useObraFormat } from "./format";
import { codeChip, columns, muted, table } from "./classes";
import StatusPill from "./StatusPill";
import { touchLink, stretchedLink } from "../../../../components/touch";

/** A small outlined tag in the chapters column. */
const TAG = "inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-xs whitespace-nowrap";

const COLUMNS = "44px minmax(160px, 1fr) 48px 120px minmax(120px, 0.8fr) minmax(140px, 1fr) 140px";

/** When a hito was paid or falls due, or how ready it is; and the invoice the Obra tab asked for. */
function useHitoNotes() {
  const t = useTranslations("obra.payments");
  const f = useObraFormat();
  return {
    /** Finishing its last chapter on the Obra tab asked Administration to invoice it. */
    requested: (hito: Hito) =>
      hito.invoiceRequestedAt && hito.status !== "invoiced" && hito.status !== "paid"
        ? t("requested", { date: f.date(hito.invoiceRequestedAt) })
        : null,
    when: (hito: Hito) => {
      if (hito.paidOn) return t("paidOn", { date: f.date(hito.paidOn) });
      if (hito.dueOn) return t("due", { date: f.date(hito.dueOn) });
      if (hito.readyPct > 0) return t("ready", { pct: hito.readyPct });
      return null;
    },
  };
}

/** The hito's chapters with how far each is, and its checks: what is still missing. */
function HitoTags({ hito }: { hito: Hito }) {
  const t = useTranslations("obra.payments");
  const done = hito.checks.filter((c) => c.done).length;
  return (
    <>
      {hito.chapters.map((chapter) => (
        <span key={chapter.code} className={TAG}>
          <span className="font-mono font-semibold text-brand-ink">{chapter.code}</span>
          <span className="text-muted-foreground">{chapter.progressPct} %</span>
        </span>
      ))}
      {hito.checks.length > 0 && <span className={TAG}>{t("checks", { done, total: hito.checks.length })}</span>}
    </>
  );
}

/** Presentational: the payment plan H0–H9, each hito with its chapters and state (from 768px). */
export default function HitoTable({
  hitos,
  totalCents,
  hitoHref,
}: {
  hitos: Hito[];
  totalCents: number;
  hitoHref: (hito: Hito) => string;
}) {
  const t = useTranslations("obra.payments");
  const f = useObraFormat();
  const { requested, when } = useHitoNotes();

  return (
    <div role="table" aria-label={t("title")} className={table.root} style={columns(COLUMNS)}>
      <div role="row" className={table.head}>
        <span role="columnheader">{t("hito")}</span>
        <span role="columnheader">{t("name")}</span>
        <span role="columnheader" className={table.right}>{t("pct")}</span>
        <span role="columnheader" className={table.right}>{t("amount")}</span>
        <span role="columnheader">{t("moment")}</span>
        <span role="columnheader">{t("chapters")}</span>
        <span role="columnheader">{t("state")}</span>
      </div>
      {hitos.map((hito) => (
        <div role="row" key={hito.id} className={table.row}>
          <span role="cell" className={codeChip}>{hito.code}</span>
          <span role="cell" className={table.name}>
            <Link href={hitoHref(hito)} className={cn(table.nameLink, touchLink)}>
              {hito.name}
            </Link>
          </span>
          <span role="cell" className={`num text-muted-foreground ${table.right}`}>{f.share(hito.pctBp)}</span>
          <span role="cell" className={`num ${table.right}`}>{f.money(hito.amountCents)}</span>
          <span role="cell" className="text-muted-foreground">{hito.billingMoment}</span>
          <span role="cell" className="flex flex-wrap gap-1.5">
            <HitoTags hito={hito} />
          </span>
          <span role="cell" className="flex flex-col items-start gap-1">
            <StatusPill status={hito.status} />
            {/* Wraps within the state column ("Factura solicitada · 14 nov 2026") rather than run past the card. */}
            {requested(hito) && <Badge variant="yel" className="rounded-[9px] whitespace-normal">{requested(hito)}</Badge>}
            {when(hito) && <span className={muted}>{when(hito)}</span>}
          </span>
        </div>
      ))}
      <div role="row" className={table.total}>
        <span role="cell" />
        <span role="cell">{t("total")}</span>
        <span role="cell" className={table.right}>{f.share(hitos.reduce((sum, h) => sum + h.pctBp, 0))}</span>
        <span role="cell" className={`num ${table.right}`}>{f.money(totalCents)}</span>
        <span role="cell" />
        <span role="cell" />
        <span role="cell" />
      </div>
    </div>
  );
}

/**
 * Presentational, below 768px: a card per hito, the whole card its link: its
 * state, share and amount, when it is invoiced, what is still missing (its
 * chapters' progress and its checks) and when it was paid or falls due; then
 * the plan's total.
 */
export function HitoCards({
  hitos,
  totalCents,
  hitoHref,
  className,
}: {
  hitos: Hito[];
  totalCents: number;
  hitoHref: (hito: Hito) => string;
  className?: string;
}) {
  const t = useTranslations("obra.payments");
  const f = useObraFormat();
  const { requested, when } = useHitoNotes();
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label={t("title")}>
        {hitos.map((hito) => (
          <li key={hito.id} className={cn(cardVariants(), "relative gap-2.5")}>
            <div className="flex items-start gap-2.5">
              <span className={codeChip}>{hito.code}</span>
              <Link href={hitoHref(hito)} className={cn("min-w-0 flex-1 leading-snug font-semibold", stretchedLink)}>
                {hito.name}
              </Link>
              <StatusPill status={hito.status} />
            </div>
            <div className="flex items-baseline justify-between gap-3">
              <span className={cn(muted, "min-w-0")}>{hito.billingMoment}</span>
              <span className="flex-none text-right">
                <span className="num font-semibold">{f.money(hito.amountCents)}</span>
                <span className="num ml-2 text-muted-foreground">{f.share(hito.pctBp)}</span>
              </span>
            </div>
            {(hito.chapters.length > 0 || hito.checks.length > 0) && (
              <div className="flex flex-wrap gap-1.5">
                <HitoTags hito={hito} />
              </div>
            )}
            {(requested(hito) || when(hito)) && (
              <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                {requested(hito) && <Badge variant="yel" className="rounded-[9px] whitespace-normal">{requested(hito)}</Badge>}
                {when(hito) && <span className={muted}>{when(hito)}</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
      <div className={cn(cardVariants(), "flex-row items-baseline justify-between gap-3 py-3 font-semibold")}>
        <span>{t("total")}</span>
        <span className="text-right">
          <span className="num">{f.money(totalCents)}</span>
          <span className="num ml-2 text-muted-foreground">{f.share(hitos.reduce((sum, h) => sum + h.pctBp, 0))}</span>
        </span>
      </div>
    </div>
  );
}
