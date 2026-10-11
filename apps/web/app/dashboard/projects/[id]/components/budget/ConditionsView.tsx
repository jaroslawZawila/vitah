"use client";

import { Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BudgetConditions, BudgetRevision, BudgetTexts, Hito } from "@repo/core/contract";
import { ofBp } from "@repo/core/obra-calc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { cardHead, codeChip, columns, muted, table } from "../obra/classes";
import { useObraFormat } from "../obra/format";
import { removeAt, replaceAt } from "./lists";
import SaveOnBlur from "./SaveOnBlur";

const COLUMNS = "48px minmax(180px, 1fr) 70px 120px minmax(160px, 1.2fr)";

/**
 * Presentational: what follows the options in the PDFs: the H0–H9 payment
 * plan (priced on this revision), exclusions, the company's fixed texts and
 * this works' contract terms. `onEditPlan` opens the plan editor.
 */
export default function ConditionsView({
  revision,
  hitos,
  onTexts,
  onConditions,
  onEditPlan,
}: {
  revision: BudgetRevision;
  hitos: Hito[];
  onTexts?: (texts: Partial<BudgetTexts>) => void;
  onConditions?: (conditions: Partial<BudgetConditions>) => void;
  onEditPlan?: () => void;
}) {
  const t = useTranslations("budget.conditions");
  const f = useObraFormat();
  const pctTotal = hitos.reduce((sum, h) => sum + h.pctBp, 0);
  const base = revision.contractTotalCents;
  const { texts, conditions } = revision;
  const saveExclusions = (exclusions: string[]) => onTexts?.({ exclusions });

  return (
    <div className="flex flex-col gap-4.5">
      <section className={cardVariants()} aria-labelledby="plan-title">
        <div className={cardHead}>
          <div>
            <p className="eyebrow">{t("planEyebrow")}</p>
            <h2 id="plan-title">{t("plan")}</h2>
          </div>
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={pctTotal === 10_000 ? "good" : "warn"}>{t(pctTotal === 10_000 ? "planOk" : "planOff", { pct: f.share(pctTotal) })}</Badge>
            {onEditPlan && <Button type="button" variant="outline" size="sm" onClick={onEditPlan}>{t("editPlan")}</Button>}
          </span>
        </div>
        <p className={muted}>{t("planHint")}</p>
        <div role="table" aria-labelledby="plan-title" className={table.root} style={columns(COLUMNS)}>
          <div role="row" className={table.head}>
            <span role="columnheader">{t("hito")}</span>
            <span role="columnheader">{t("name")}</span>
            <span role="columnheader" className={table.right}>%</span>
            <span role="columnheader" className={table.right}>{t("amount")}</span>
            <span role="columnheader">{t("when")}</span>
          </div>
          {hitos.map((hito) => (
            <div role="row" key={hito.id} className={table.row}>
              <span role="cell" className={codeChip}>{hito.code}</span>
              <span role="cell" className={table.name}>{hito.name}</span>
              <span role="cell" className={`num ${table.right}`}>{f.share(hito.pctBp)}</span>
              <span role="cell" className={`num ${table.right}`}>{f.money(ofBp(base, hito.pctBp))}</span>
              <span role="cell" className="text-muted-foreground">{hito.billingMoment}</span>
            </div>
          ))}
          <div role="row" className={table.total}>
            <span role="cell" />
            <span role="cell">{t("total")}</span>
            <span role="cell" className={`num ${table.right}`}>{f.share(pctTotal)}</span>
            <span role="cell" className={`num ${table.right}`}>{f.money(base)}</span>
            <span role="cell" className="font-normal text-muted-foreground">{t("paymentTerm")}</span>
          </div>
        </div>
      </section>

      <div className="flex flex-col gap-4.5 lg:flex-row lg:items-start">
        <section className={cn(cardVariants(), "flex-1")} aria-labelledby="exclusions-title">
          <div>
            <p className="eyebrow">{t("bothPdfs")}</p>
            <h2 id="exclusions-title">{t("exclusions")}</h2>
          </div>
          <ol className="flex flex-col">
            {texts.exclusions.map((item, i) => (
              <li key={`${i}-${item}`} className="flex items-start gap-2.5 border-t py-2">
                <span className="num pt-2 text-muted-foreground">{i + 1}</span>
                <SaveOnBlur label={t("exclusion", { n: i + 1 })} value={item} multiline rows={2} className="flex-1" onSave={onTexts ? (value) => saveExclusions(replaceAt(texts.exclusions, i, value)) : undefined} />
                {onTexts && (
                  <Button type="button" variant="ghost" size="icon-sm" className="hover:text-bad" aria-label={t("removeExclusion", { n: i + 1 })} onClick={() => saveExclusions(removeAt(texts.exclusions, i))}>
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </li>
            ))}
          </ol>
          {onTexts && (
            <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => saveExclusions([...texts.exclusions, t("newExclusion")])}>
              + {t("addExclusion")}
            </Button>
          )}
          <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-muted-foreground">
            {t("includes")}
            <SaveOnBlur key={texts.includes} label={t("includes")} multiline rows={3} value={texts.includes} onSave={onTexts ? (includes) => onTexts({ includes }) : undefined} />
          </label>
        </section>

        <section className={cn(cardVariants(), "flex-1")} aria-labelledby="fixed-title">
          <div>
            <p className="eyebrow">{t("fixedEyebrow")}</p>
            <h2 id="fixed-title">{t("fixed")}</h2>
          </div>
          {(["guarantees", "documents", "contract"] as const).map((key) => (
            <div key={key} className="flex flex-wrap items-center justify-between gap-3 border-t py-3 text-sm">
              <span>
                <b>{t(`fixedItems.${key}`)}</b>
                <span className={cn(muted, "block")}>{t(`fixedHints.${key}`)}</span>
              </span>
              <Badge variant={key === "contract" ? "outline" : "good"}>{t(key === "contract" ? "detailedOnly" : "bothPdfs")}</Badge>
            </div>
          ))}
          <p className={muted}>{t("fixedNote")}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["validityDays", "term", "penalty", "signingPlace"] as const).map((key) => (
              <label key={key} className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-muted-foreground">
                {t(`terms.${key}`)}
                <SaveOnBlur
                  key={key + String(conditions[key])}
                  label={t(`terms.${key}`)}
                  value={String(conditions[key])}
                  onSave={
                    onConditions
                      ? (value) => onConditions(key === "validityDays" ? { validityDays: Number.parseInt(value, 10) || Number.NaN } : { [key]: value })
                      : undefined
                  }
                />
              </label>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
