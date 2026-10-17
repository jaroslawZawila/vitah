"use client";

import { useTranslations } from "next-intl";
import { Ban, TriangleAlert } from "lucide-react";
import { MACHINERY, MAX_CHAIN_LEVEL, PREVENTION_MODES, SUBCONTRACTOR_TRADES } from "@repo/core/contract";
import { Field, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { fieldStyles as f } from "../../../components/wizard/fields";
import { segmentStyles } from "./CompanyDataFields";
import { permanentExceedsHeadcount, permanentShareLow, toggle, type CompanyFormDraft } from "./draft";
import ToggleChip from "./ToggleChip";

export function Notice({ tone, children }: { tone: "warn" | "bad"; children: React.ReactNode }) {
  const Icon = tone === "warn" ? TriangleAlert : Ban;
  return (
    <p
      className={cn(
        "m-0 flex items-start gap-2.5 rounded-[10px] px-3.5 py-3 text-[13.5px] font-medium",
        tone === "warn" ? "bg-warn-soft text-warn" : "bg-bad-soft text-bad",
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 flex-none" />
      <span>{children}</span>
    </p>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 border-t pt-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h3>{title}</h3>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </div>
      {children}
    </section>
  );
}

/**
 * Presentational: what the company does and how it handles prevention, with
 * the checks of Ley 32/2006 (30 % permanent staff, no subcontracting by the
 * self-employed, at most three levels).
 */
export default function ActivityFields({
  draft,
  onChange,
}: {
  draft: CompanyFormDraft;
  onChange: (patch: Partial<CompanyFormDraft>) => void;
}) {
  const t = useTranslations("subcontractors.fields");
  const tr = useTranslations("subcontractors");
  const selfEmployed = draft.kind === "self_employed";
  const headcount = Number(draft.headcount);
  const permanent = Number(draft.permanentCount);
  const share =
    draft.headcount !== "" && draft.permanentCount !== "" && headcount > 0
      ? Math.round((permanent / headcount) * 100)
      : null;
  const low = permanentShareLow(draft);
  const exceeds = permanentExceedsHeadcount(draft);

  return (
    <div className="flex flex-col gap-5">
      <Section title={t("trades")} hint={t("tradesHint")}>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("trades")}>
          {SUBCONTRACTOR_TRADES.map((trade) => (
            <ToggleChip
              key={trade}
              on={draft.trades.includes(trade)}
              onToggle={() => onChange({ trades: toggle(draft.trades, trade) })}
            >
              {tr(`trades.${trade}`)}
            </ToggleChip>
          ))}
        </div>
      </Section>

      <Section title={t("installer")} hint={t("installerHint")}>
        <div className={f.fields}>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium">
            <input
              type="checkbox"
              className="size-[18px] accent-primary"
              checked={draft.isInstaller}
              onChange={(e) => onChange({ isInstaller: e.target.checked })}
            />
            {t("isInstaller")}
          </label>
          {draft.isInstaller && (
            <Field>
              <Label htmlFor="company-installerReg">{t("installerReg")}</Label>
              <Input
                id="company-installerReg"
                className="num"
                maxLength={200}
                value={draft.installerReg}
                onChange={(e) => onChange({ installerReg: e.target.value })}
              />
            </Field>
          )}
        </div>
      </Section>

      <Section title={t("workforce")} hint={t("workforceHint")}>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field>
            <Label htmlFor="company-headcount">{t("headcount")}</Label>
            <Input
              id="company-headcount"
              type="number"
              min={0}
              className="num"
              value={draft.headcount}
              onChange={(e) => onChange({ headcount: e.target.value })}
            />
          </Field>
          <Field>
            <Label htmlFor="company-permanentCount">{t("permanentCount")}</Label>
            <Input
              id="company-permanentCount"
              type="number"
              min={0}
              max={draft.headcount || undefined}
              className="num"
              value={draft.permanentCount}
              aria-invalid={exceeds || undefined}
              onChange={(e) => onChange({ permanentCount: e.target.value })}
            />
          </Field>
          <Field>
            <span className="text-xs leading-none font-medium text-muted-foreground">{t("permanentShare")}</span>
            <div
              className={cn(
                "flex min-h-10 items-center rounded-md px-3 font-mono text-sm font-semibold",
                low ? "bg-warn-soft text-warn" : share === null ? "bg-raise text-muted-foreground" : "bg-brand-soft text-brand-ink",
              )}
            >
              {share === null ? "—" : `${share} %`}
            </div>
          </Field>
        </div>
        {exceeds && <Notice tone="bad">{tr("errors.permanent_exceeds_headcount")}</Notice>}
        {low && !exceeds && <Notice tone="warn">{t("lowPermanentShare")}</Notice>}
      </Section>

      <Section title={t("subcontracts")} hint={t("subcontractsHint", { max: MAX_CHAIN_LEVEL })}>
        <fieldset className="m-0 border-0 p-0">
          <legend className="sr-only">{t("subcontracts")}</legend>
          <div className={segmentStyles.group}>
            {[false, true].map((value) => (
              <label key={String(value)} className={segmentStyles.option}>
                <input
                  type="radio"
                  name="company-subcontracts"
                  checked={draft.subcontractsFurther === value}
                  disabled={value && selfEmployed}
                  onChange={() => onChange({ subcontractsFurther: value })}
                />
                {value ? t("yes") : t("no")}
              </label>
            ))}
          </div>
        </fieldset>
        {selfEmployed && <Notice tone="bad">{tr("errors.self_employed_cannot_subcontract")}</Notice>}
        <Field className="max-w-xs">
          <Label htmlFor="company-chainLevel">{t("chainLevel")}</Label>
          <NativeSelect
            id="company-chainLevel"
            value={draft.chainLevel}
            onChange={(e) => onChange({ chainLevel: e.target.value })}
          >
            {Array.from({ length: MAX_CHAIN_LEVEL }, (_, i) => String(i + 1)).map((level) => (
              <NativeSelectOption
                key={level}
                value={level}
                disabled={draft.subcontractsFurther && Number(level) === MAX_CHAIN_LEVEL}
              >
                {t(`chainLevels.${level}`)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
          <FieldDescription>{t("chainLevelHint")}</FieldDescription>
        </Field>
      </Section>

      <Section title={t("prevention")} hint={t("preventionHint")}>
        <fieldset className="m-0 grid gap-2 border-0 p-0 sm:grid-cols-2">
          <legend className="sr-only">{t("prevention")}</legend>
          {PREVENTION_MODES.map((mode) => (
            <label key={mode} className={f.choice}>
              <input
                type="radio"
                name="company-preventionMode"
                value={mode}
                checked={draft.preventionMode === mode}
                onChange={() => onChange({ preventionMode: mode })}
              />
              <span className={f.choiceText}>
                <span className="font-semibold">{tr(`preventionModes.${mode}.label`)}</span>
                <span className={f.choiceHint}>{tr(`preventionModes.${mode}.hint`)}</span>
              </span>
            </label>
          ))}
        </fieldset>
        <div className={f.fields}>
          <Field>
            <Label htmlFor="company-preventionEntity">{t("preventionEntity")}</Label>
            <Input
              id="company-preventionEntity"
              maxLength={200}
              value={draft.preventionEntity}
              onChange={(e) => onChange({ preventionEntity: e.target.value })}
            />
          </Field>
          <Field>
            <Label htmlFor="company-preventionValidUntil">{t("preventionValidUntil")}</Label>
            <Input
              id="company-preventionValidUntil"
              type="date"
              value={draft.preventionValidUntil}
              onChange={(e) => onChange({ preventionValidUntil: e.target.value })}
            />
          </Field>
        </div>
      </Section>

      <Section title={t("machinery")} hint={t("machineryHint")}>
        <div className={f.fields}>
          {MACHINERY.map((machine) => (
            <label key={machine} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium lg:min-h-9">
              <input
                type="checkbox"
                className="size-[18px] accent-primary"
                checked={draft.machinery.includes(machine)}
                onChange={() => onChange({ machinery: toggle(draft.machinery, machine) })}
              />
              {tr(`machinery.${machine}`)}
            </label>
          ))}
        </div>
      </Section>
    </div>
  );
}
