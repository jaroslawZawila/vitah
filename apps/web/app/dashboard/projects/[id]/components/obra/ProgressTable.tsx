"use client";

import { useTranslations } from "next-intl";
import type { BudgetLine } from "@repo/core/contract";
import { useObraFormat } from "./format";
import { Input } from "@/components/ui/input";
import { columns, pctInput, table } from "./classes";
import ProgressBar from "./ProgressBar";

const COLUMNS = "56px minmax(180px, 1fr) 40px 80px 110px 200px 110px";

/** Presentational: a chapter's lines (as edited) with an executed-% input each. */
export default function ProgressTable({
  code,
  lines,
  progress,
  onChange,
  disabled,
}: {
  code: string;
  lines: BudgetLine[];
  /** The chapter's progress with these lines. */
  progress: { totalCents: number; executedCents: number; progressPct: number };
  onChange: (lineId: string, pct: number) => void;
  disabled: boolean;
}) {
  const t = useTranslations("obra.chapter");
  const f = useObraFormat();

  return (
    <div role="table" aria-label={t("lines")} className={table.root} style={columns(COLUMNS)}>
      <div role="row" className={table.head}>
        <span role="columnheader">{t("codeCol")}</span>
        <span role="columnheader">{t("description")}</span>
        <span role="columnheader">{t("unit")}</span>
        <span role="columnheader" className={table.right}>{t("qty")}</span>
        <span role="columnheader" className={table.right}>{t("amount")}</span>
        <span role="columnheader">{t("executed")}</span>
        <span role="columnheader" className={table.right}>{t("executedAmount")}</span>
      </div>
      {lines.map((line) => {
        const pct = line.executedPct;
        return (
          <div role="row" key={line.id} className={table.row}>
            <span role="cell" className="num text-muted-foreground">{line.code}</span>
            <span role="cell" className={table.name}>{line.description}</span>
            <span role="cell" className="text-muted-foreground">{line.unit}</span>
            <span role="cell" className={`num ${table.right}`}>{f.quantity(line.quantity)}</span>
            <span role="cell" className={`num ${table.right}`}>{f.money(line.amountCents)}</span>
            <span role="cell" className={table.progress}>
              <span className={pctInput.root}>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={5}
                  inputMode="numeric"
                  className={pctInput.input}
                  aria-label={t("executedLabel", { code: line.code })}
                  value={pct}
                  disabled={disabled}
                  onChange={(event) => {
                    const next = Math.round(Number(event.target.value));
                    onChange(line.id, Number.isFinite(next) ? Math.min(100, Math.max(0, next)) : 0);
                  }}
                />
                <span className={pctInput.sign} aria-hidden>%</span>
              </span>
              <ProgressBar pct={pct} />
            </span>
            <span role="cell" className={`num ${table.right}`}>
              {f.money(Math.round((line.amountCents * pct) / 100))}
            </span>
          </div>
        );
      })}
      <div role="row" className={table.total}>
        <span role="cell" />
        <span role="cell">{t("subtotal", { code })}</span>
        <span role="cell" />
        <span role="cell" />
        <span role="cell" className={`num ${table.right}`}>{f.money(progress.totalCents)}</span>
        <span role="cell">{progress.progressPct} %</span>
        <span role="cell" className={`num ${table.right}`}>{f.money(progress.executedCents)}</span>
      </div>
    </div>
  );
}
