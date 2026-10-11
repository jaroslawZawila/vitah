"use client";

import { useTranslations } from "next-intl";
import type { BudgetRevision } from "@repo/core/contract";
import { cardVariants } from "@/components/ui/card";
import { useObraFormat } from "./format";
import { cardHead, codeChip, columns, muted, table } from "./classes";

const COLUMNS = "48px minmax(160px, 1.2fr) 120px 120px 120px minmax(120px, 1.5fr)";

/** Presentational: how the revision's chapters differ from the previous revision's. */
export default function BudgetChanges({ revision }: { revision: BudgetRevision }) {
  const t = useTranslations("obra.budget");
  const f = useObraFormat();
  const previous = revision.previous;
  if (!previous) return null;
  const rows = [
    ...revision.chapters
      .filter((c) => c.change !== null)
      .map((c) => ({ code: c.code, name: c.name, before: c.previousTotalCents, after: c.totalCents, why: c.changeNote })),
    ...revision.removedChapters.map((c) => ({ code: c.code, name: c.name, before: c.totalCents, after: null, why: t("removed") })),
  ];
  const title = t("changes", { number: previous.number });

  return (
    <section className={cardVariants()}>
      <div className={cardHead}>
        <h2>{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className={muted}>{t("noChanges")}</p>
      ) : (
        <div role="table" aria-label={title} className={table.root} style={columns(COLUMNS)}>
          <div role="row" className={table.head}>
            <span role="columnheader">{t("codeCol")}</span>
            <span role="columnheader">{t("descriptionCol")}</span>
            <span role="columnheader" className={table.right}>{t("before", { number: previous.number })}</span>
            <span role="columnheader" className={table.right}>{t("after", { number: revision.number })}</span>
            <span role="columnheader" className={table.right}>{t("delta")}</span>
            <span role="columnheader">{t("changesWhy")}</span>
          </div>
          {rows.map((row) => (
            <div role="row" key={row.code} className={table.row}>
              <span role="cell" className={codeChip}>{row.code}</span>
              <span role="cell" className={table.name}>{row.name}</span>
              <span role="cell" className={`num text-muted-foreground ${table.right}`}>{row.before === null ? "—" : f.money(row.before)}</span>
              <span role="cell" className={`num ${table.right}`}>{row.after === null ? "—" : f.money(row.after)}</span>
              <span role="cell" className={`num font-semibold ${table.right}`}>
                {f.signedMoney((row.after ?? 0) - (row.before ?? 0))}
              </span>
              <span role="cell" className="text-muted-foreground">{row.why ?? ""}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
