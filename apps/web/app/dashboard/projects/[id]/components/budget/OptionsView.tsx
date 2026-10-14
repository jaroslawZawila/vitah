"use client";

import { useTranslations } from "next-intl";
import { codeRange, OPTION_KINDS, type BudgetOption, type BudgetRevision, type OptionKind, type PriceBaseItem } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { muted } from "../obra/classes";
import { useObraFormat } from "../obra/format";
import Kpi from "../obra/Kpi";
import LineTable, { type LineOps } from "./LineTable";
import { OPTION_VARIANT } from "./OptionSummary";
import PriceBaseButton from "./PriceBasePicker";
import SaveOnBlur from "./SaveOnBlur";

/** The line operations, and the options' own. */
export type OptionHandlers = LineOps & {
  onAddOption: (item: PriceBaseItem) => void;
  onAddEmptyOption: () => void;
  onUpdateOption: (option: BudgetOption, changes: { name?: string; optionKind?: OptionKind; intro?: string }) => void;
  onDeleteOption: (option: BudgetOption) => void;
};

/**
 * Presentational: the options below the twenty chapters, each a "Partida
 * opcional" with its OP lines. Adding (extras) or subtracting (alternatives,
 * deductions); the client chooses on acceptance.
 */
export default function OptionsView({ revision, handlers }: { revision: BudgetRevision; handlers?: OptionHandlers }) {
  const t = useTranslations("budget.options");
  const f = useObraFormat();
  const { adding, subtracting } = revision.optionTotals;

  return (
    <div className="flex flex-col gap-4.5">
      <p className="max-w-[820px] text-sm text-muted-foreground">{t("intro")}</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex flex-wrap gap-1.5">
          <Badge variant="default">{t("adding", { count: adding.count, amount: f.signedMoney(adding.cents) })}</Badge>
          <Badge variant="info">{t("subtracting", { count: subtracting.count, amount: f.money(subtracting.cents) })}</Badge>
        </span>
        {handlers && (
          <span className="flex flex-wrap gap-2">
            <PriceBaseButton
              label={t("fromBase")}
              variant="outline"
              chapter={null}
              onSearch={handlers.onSearch}
              onPick={handlers.onAddOption}
              onFree={handlers.onAddEmptyOption}
              freeLabel={t("empty")}
            />
            <Button type="button" variant="ghost" onClick={handlers.onAddEmptyOption}>
              + {t("empty")}
            </Button>
          </span>
        )}
      </div>

      {revision.options.length === 0 && <p className={`${cardVariants()} ${muted}`}>{t("none")}</p>}
      {revision.options.map((option) => (
        <section key={option.id} className={cardVariants()} aria-label={option.name}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={OPTION_VARIANT[option.optionKind]}>{t(`kinds.${option.optionKind}`)}</Badge>
                <span className="eyebrow">{t("range", { range: codeRange(option.lines) })}</span>
                {option.chosen === true && <Badge variant="good">{t("chosen")}</Badge>}
                {option.chosen === false && <Badge variant="outline">{t("declined")}</Badge>}
              </div>
              {handlers ? (
                <SaveOnBlur key={option.id + option.name} label={t("name")} value={option.name} onSave={(name) => handlers.onUpdateOption(option, { name })} className="h-9 min-w-[280px] font-heading text-xl font-bold" />
              ) : (
                <h2>{option.name}</h2>
              )}
              {option.replacesLine && <p className={muted}>{t("replaces", { code: option.replacesLine })}</p>}
            </div>
            <span className="flex flex-col items-end">
              <span className="num text-xl font-semibold">{f.signedMoney(option.priceCents)}</span>
              <span className={muted}>{t("price")}</span>
            </span>
          </div>
          {handlers && (
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-[12.5px] font-semibold text-muted-foreground">
                {t("kind")}
                <NativeSelect value={option.optionKind} onChange={(event) => handlers.onUpdateOption(option, { optionKind: event.target.value as OptionKind })}>
                  {OPTION_KINDS.map((kind) => (
                    <option key={kind} value={kind}>{t(`kinds.${kind}`)}</option>
                  ))}
                </NativeSelect>
              </label>
            </div>
          )}
          <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-muted-foreground">
            <span>
              {t("introLabel")} <span className="font-normal">{t("introHint")}</span>
            </span>
            <SaveOnBlur key={option.id + (option.pdfNote ?? "")} label={t("introLabel")} multiline rows={2} value={option.pdfNote ?? ""} onSave={handlers ? (intro) => handlers.onUpdateOption(option, { intro }) : undefined} />
          </label>
          <LineTable
            label={option.name}
            lines={option.lines}
            onUpdate={handlers?.onUpdate}
            menuFor={handlers ? (line) => [
              { label: t("editLine"), onSelect: () => handlers.onEdit(option, line) },
              { label: t("deleteLine"), onSelect: () => handlers.onDelete(line), destructive: true },
            ] : undefined}
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            {handlers ? (
              <span className="flex flex-wrap gap-1">
                <PriceBaseButton
                  label={t("addLine")}
                  variant="outline"
                  size="sm"
                  popoverClassName="right-auto left-0"
                  chapter={null}
                  onSearch={handlers.onSearch}
                  onPick={(item) => handlers.onAddFromBase(option, item)}
                  onFree={() => handlers.onAddFree(option)}
                  freeLabel={t("freeLine")}
                />
                <Button type="button" variant="ghost-destructive" size="sm" onClick={() => handlers.onDeleteOption(option)}>
                  {t("delete")}
                </Button>
              </span>
            ) : (
              <span />
            )}
            <strong className="text-sm">{t("total", { name: option.name, amount: f.money(option.totalCents) })}</strong>
          </div>
        </section>
      ))}

      <section className="grid gap-3.5 md:grid-cols-3">
        <Kpi label={t("pec")} value={f.money(revision.totalCents)} hints={[t("pecHint")]} />
        <Kpi label={t("withAdding")} value={f.money(revision.totalCents + adding.cents)} hints={[f.signedMoney(adding.cents)]} />
        <Kpi label={t("withSubtracting")} value={f.money(revision.totalCents + subtracting.cents)} hints={[f.money(subtracting.cents)]} />
      </section>
    </div>
  );
}
