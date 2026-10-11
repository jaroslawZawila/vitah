"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { codeRange, type BudgetOption } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { cardHead, columns, muted, table } from "../obra/classes";
import { useObraFormat } from "../obra/format";

const COLUMNS = "110px minmax(200px, 1fr) 130px 130px";
export const OPTION_VARIANT = { extra: "default", alternative: "warn", deduction: "info" } as const;


/** Presentational: the options below the twenty chapters, outside the PEC. */
export default function OptionSummary({ options, href }: { options: BudgetOption[]; href: string }) {
  const t = useTranslations("budget.options");
  const f = useObraFormat();
  return (
    <section className={cardVariants()} aria-labelledby="option-summary-title">
      <div className={cardHead}>
        <h2 id="option-summary-title">
          {t("summaryTitle")} <span className={`${muted} font-sans font-normal`}>{t("summaryHint")}</span>
        </h2>
        <Link href={href} className="text-sm font-semibold text-brand-ink hover:underline">{t("edit")}</Link>
      </div>
      {options.length === 0 ? (
        <p className={muted}>{t("none")}</p>
      ) : (
        <div role="table" aria-labelledby="option-summary-title" className={table.root} style={columns(COLUMNS)}>
          {options.map((option) => (
            <div role="row" key={option.id} className={table.row}>
              <span role="cell" className="num text-muted-foreground">{codeRange(option.lines)}</span>
              <span role="cell" className={table.name}>{option.name}</span>
              <span role="cell" className={`num font-semibold ${table.right}`}>{f.signedMoney(option.totalCents)}</span>
              <span role="cell" className="flex flex-wrap gap-1.5">
                <Badge variant={OPTION_VARIANT[option.optionKind]}>{t(`kinds.${option.optionKind}`)}</Badge>
                {option.chosen === true && <Badge variant="good">{t("chosen")}</Badge>}
                {option.chosen === false && <Badge variant="outline">{t("declined")}</Badge>}
              </span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
