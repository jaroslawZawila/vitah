"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import type { Hito } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { useObraFormat } from "./format";
import { codeChip, columns, muted, table } from "./classes";
import StatusPill from "./StatusPill";

/** A small outlined tag in the chapters column. */
const TAG = "inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-[11.5px] whitespace-nowrap";

const COLUMNS = "44px minmax(160px, 1fr) 48px 120px minmax(120px, 0.8fr) minmax(140px, 1fr) 140px";

/** Presentational: the payment plan H0–H9, each hito with its chapters and state. */
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
  const format = useFormatter();
  /** Finishing its last chapter on the Obra tab asked Administration to invoice it. */
  const requested = (hito: Hito) =>
    hito.invoiceRequestedAt && hito.status !== "invoiced" && hito.status !== "paid"
      ? format.dateTime(new Date(hito.invoiceRequestedAt), { dateStyle: "medium", timeZone: "Europe/Madrid" })
      : null;
  const when = (hito: Hito) => {
    if (hito.paidOn) return t("paidOn", { date: f.date(hito.paidOn) });
    if (hito.dueOn) return t("due", { date: f.date(hito.dueOn) });
    if (hito.readyPct > 0) return t("ready", { pct: hito.readyPct });
    return null;
  };

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
      {hitos.map((hito) => {
        const done = hito.checks.filter((c) => c.done).length;
        return (
          <div role="row" key={hito.id} className={table.row}>
            <span role="cell" className={codeChip}>{hito.code}</span>
            <span role="cell" className={table.name}>
              <Link href={hitoHref(hito)} className={table.nameLink}>
                {hito.name}
              </Link>
            </span>
            <span role="cell" className={`num text-muted-foreground ${table.right}`}>{f.share(hito.pctBp)}</span>
            <span role="cell" className={`num ${table.right}`}>{f.money(hito.amountCents)}</span>
            <span role="cell" className="text-muted-foreground">{hito.billingMoment}</span>
            <span role="cell" className="flex flex-wrap gap-1.5">
              {hito.chapters.map((chapter) => (
                <span key={chapter.code} className={TAG}>
                  <span className="font-mono font-semibold text-brand-ink">{chapter.code}</span>
                  <span className="text-muted-foreground">{chapter.progressPct} %</span>
                </span>
              ))}
              {hito.checks.length > 0 && (
                <span className={TAG}>{t("checks", { done, total: hito.checks.length })}</span>
              )}
            </span>
            <span role="cell" className="flex flex-col items-start gap-1">
              <StatusPill status={hito.status} />
              {requested(hito) && <Badge variant="yel">{t("requested", { date: requested(hito)! })}</Badge>}
              {when(hito) && <span className={muted}>{when(hito)}</span>}
            </span>
          </div>
        );
      })}
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
