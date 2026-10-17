"use client";

import type { FormEvent } from "react";
import { useTranslations } from "next-intl";
import {
  CONTRACT_TYPES,
  PPE_ITEMS,
  ROLE_TRAININGS,
  SUBCONTRACTOR_TRADES,
  WORKER_CATEGORIES,
  WORKER_ROLES,
  isValidPersonalId,
  normalizeIdNumber,
  type SubcontractorError,
} from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FieldDescription, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import FormError from "../../../components/FormError";
import { fieldStyles as f } from "../../../components/wizard/fields";
import { toggle } from "../fields/draft";
import ToggleChip from "../fields/ToggleChip";
import { useRequirementName } from "../display";
import type { CompanyChoice, WorkerFormDraft } from "./draft";

/**
 * Presentational: a worker's details — personal data, contract, TPC, PPE
 * handed over and site roles. Their documents are managed apart.
 */
export default function WorkerForm({
  draft,
  onChange,
  companies,
  canManage,
  pending,
  error,
  submitLabel,
  onSubmit,
}: {
  draft: WorkerFormDraft;
  onChange: (patch: Partial<WorkerFormDraft>) => void;
  companies: CompanyChoice[];
  canManage: boolean;
  pending: boolean;
  error?: SubcontractorError;
  submitLabel: string;
  onSubmit: () => void;
}) {
  const t = useTranslations("subcontractors.worker.form");
  const tr = useTranslations("subcontractors");
  const requirementName = useRequirementName();
  const id = normalizeIdNumber(draft.idDocument);
  const idValid = id ? isValidPersonalId(id) : null;

  const input = (key: keyof WorkerFormDraft, label: string, props: React.ComponentProps<typeof Input> = {}) => (
    <Field>
      <Label htmlFor={`worker-${key}`}>{label}</Label>
      <Input id={`worker-${key}`} value={draft[key] as string} onChange={(e) => onChange({ [key]: e.target.value })} {...props} />
    </Field>
  );
  const select = (key: keyof WorkerFormDraft, label: string, options: readonly string[], ns: string) => (
    <Field>
      <Label htmlFor={`worker-${key}`}>{label}</Label>
      <NativeSelect id={`worker-${key}`} value={draft[key] as string} onChange={(e) => onChange({ [key]: e.target.value })}>
        <NativeSelectOption value="">{t("choose")}</NativeSelectOption>
        {options.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {tr(`${ns}.${option}`)}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    </Field>
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className="flex min-w-0 flex-col gap-4" onSubmit={handleSubmit} aria-label={t("label")}>
      <fieldset disabled={!canManage} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <section className={cardVariants()} aria-labelledby="worker-personal">
          <h2 id="worker-personal">{t("personal")}</h2>
          <div className={f.fields}>
            {input("firstName", t("firstName"), { required: true, maxLength: 200 })}
            {input("surnames", t("surnames"), { required: true, maxLength: 200 })}
            <Field>
              <Label htmlFor="worker-idDocument">{t("idDocument")}</Label>
              <Input
                id="worker-idDocument"
                required
                className="num"
                value={draft.idDocument}
                aria-invalid={idValid === false || undefined}
                aria-describedby="worker-idDocument-hint"
                onChange={(e) => onChange({ idDocument: e.target.value })}
              />
              <FieldDescription
                id="worker-idDocument-hint"
                aria-live="polite"
                className={cn(idValid === true && "font-semibold text-good", idValid === false && "text-destructive")}
              >
                {idValid === null ? t("idDocumentHint") : idValid ? t("idDocumentValid") : tr("errors.invalid_id_document")}
              </FieldDescription>
            </Field>
            {input("phone", t("phone"), { type: "tel", maxLength: 20 })}
            <Field className={f.wide}>
              <Label htmlFor="worker-subcontractorId">{t("company")}</Label>
              <NativeSelect
                id="worker-subcontractorId"
                required
                value={draft.subcontractorId}
                onChange={(e) => onChange({ subcontractorId: e.target.value })}
              >
                <NativeSelectOption value="" disabled>
                  {t("chooseCompany")}
                </NativeSelectOption>
                {companies.map((c) => (
                  <NativeSelectOption key={c.id} value={c.id}>
                    {c.legalName}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            {select("category", t("category"), WORKER_CATEGORIES, "categories")}
            {select("trade", t("trade"), SUBCONTRACTOR_TRADES, "trades")}
          </div>
          <FieldDescription>{t("tradeHint")}</FieldDescription>
        </section>

        <section className={cardVariants()} aria-labelledby="worker-contract">
          <h2 id="worker-contract">{t("contract")}</h2>
          <div className="grid gap-3 md:grid-cols-3">
            {input("ssNumber", t("ssNumber"), { className: "num", maxLength: 20 })}
            {select("contractType", t("contractType"), CONTRACT_TYPES, "contractTypes")}
            {input("startDate", t("startDate"), { type: "date" })}
          </div>
        </section>

        <section className={cardVariants()} aria-labelledby="worker-tpc">
          <h2 id="worker-tpc">{t("tpc")}</h2>
          <div className={f.fields}>{input("tpcNumber", t("tpcNumber"), { className: "num", maxLength: 30 })}</div>
          <FieldDescription>{t("tpcHint")}</FieldDescription>
        </section>

        <section className={cardVariants()} aria-labelledby="worker-ppe">
          <h2 id="worker-ppe">{t("ppe")}</h2>
          <div className="flex flex-wrap gap-1.5" role="group" aria-labelledby="worker-ppe">
            {PPE_ITEMS.map((item) => (
              <ToggleChip
                key={item}
                on={draft.ppeItems.includes(item)}
                onToggle={() => onChange({ ppeItems: toggle(draft.ppeItems, item) })}
              >
                {tr(`ppe.${item}`)}
              </ToggleChip>
            ))}
          </div>
          <FieldDescription>{t("ppeHint")}</FieldDescription>
        </section>

        <section className={cardVariants()} aria-labelledby="worker-roles">
          <h2 id="worker-roles">{t("roles")}</h2>
          {WORKER_ROLES.map((role) => (
            <label key={role} className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium">
              <input
                type="checkbox"
                className="size-[18px] flex-none accent-primary"
                checked={draft.roles.includes(role)}
                onChange={() => onChange({ roles: toggle(draft.roles, role) })}
              />
              <span>
                {tr(`roles.${role}`)}
                <span className="text-xs font-normal text-muted-foreground">
                  {" · "}
                  {t("roleNeeds", { document: requirementName(ROLE_TRAININGS[role]) })}
                </span>
              </span>
            </label>
          ))}
        </section>
      </fieldset>

      <FormError namespace="subcontractors.errors" error={error} />
      {canManage && (
        <FormActions>
          <Button type="submit" disabled={pending || idValid === false}>
            {pending ? t("saving") : submitLabel}
          </Button>
        </FormActions>
      )}
    </form>
  );
}
