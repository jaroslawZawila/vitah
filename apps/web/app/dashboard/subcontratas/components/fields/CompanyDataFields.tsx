"use client";

import { useTranslations } from "next-intl";
import { MapPin } from "lucide-react";
import { SUBCONTRACTOR_KINDS, provinceForPostalCode } from "@repo/core/contract";
import { Field, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { fieldStyles as f } from "../../../components/wizard/fields";
import { taxIdValid, type CompanyFormDraft } from "./draft";

export const segmentStyles = {
  group: "m-0 flex w-fit flex-wrap gap-[3px] rounded-[10px] border bg-raise p-[3px]",
  option:
    "flex min-h-11 cursor-pointer items-center rounded-[7px] px-4 text-[13.5px] font-semibold text-muted-foreground transition-colors has-checked:bg-card has-checked:text-foreground has-checked:shadow-card has-disabled:cursor-not-allowed has-disabled:opacity-45 lg:min-h-9 [&>input]:sr-only",
};

/**
 * Presentational: who the company is and how to reach it. The province fills
 * in from the postal code, and so does the region whose REA it is checked in.
 */
export default function CompanyDataFields({
  draft,
  onChange,
}: {
  draft: CompanyFormDraft;
  onChange: (patch: Partial<CompanyFormDraft>) => void;
}) {
  const t = useTranslations("subcontractors.fields");
  const tr = useTranslations("subcontractors");
  const selfEmployed = draft.kind === "self_employed";
  const valid = taxIdValid(draft);
  const place = provinceForPostalCode(draft.postalCode.trim());

  function setPostalCode(postalCode: string) {
    const previous = provinceForPostalCode(draft.postalCode.trim())?.province;
    const next = provinceForPostalCode(postalCode.trim());
    const keepProvince = draft.province !== "" && draft.province !== previous;
    onChange({ postalCode, ...(next && !keepProvince ? { province: next.province } : {}) });
  }

  const text = (
    key: keyof CompanyFormDraft,
    label: string,
    props: React.ComponentProps<typeof Input> = {},
    wide = false,
  ) => (
    <Field className={wide ? f.wide : undefined}>
      <Label htmlFor={`company-${key}`}>{label}</Label>
      <Input id={`company-${key}`} value={draft[key] as string} onChange={(e) => onChange({ [key]: e.target.value })} {...props} />
    </Field>
  );

  return (
    <div className={f.fields}>
      <fieldset className={cn("m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0", f.wide)}>
        <legend className="mb-1.5 p-0 text-xs font-medium text-muted-foreground">{t("kind")}</legend>
        <div className={segmentStyles.group}>
          {SUBCONTRACTOR_KINDS.map((kind) => (
            <label key={kind} className={segmentStyles.option}>
              <input
                type="radio"
                name="company-kind"
                value={kind}
                checked={draft.kind === kind}
                onChange={() =>
                  onChange(kind === "self_employed" ? { kind, subcontractsFurther: false } : { kind })
                }
              />
              {tr(`kinds.${kind}`)}
            </label>
          ))}
        </div>
      </fieldset>

      {text("legalName", selfEmployed ? t("fullName") : t("legalName"), { required: true, maxLength: 200 }, true)}

      <Field>
        <Label htmlFor="company-taxId">{selfEmployed ? t("nif") : t("cif")}</Label>
        <Input
          id="company-taxId"
          required
          className="num"
          value={draft.taxId}
          aria-invalid={valid === false || undefined}
          aria-describedby="company-taxId-hint"
          onChange={(e) => onChange({ taxId: e.target.value })}
        />
        <FieldDescription
          id="company-taxId-hint"
          aria-live="polite"
          className={cn(valid === true && "font-semibold text-good", valid === false && "text-destructive")}
        >
          {valid === null ? t("taxIdHint") : valid ? t("taxIdValid") : tr("errors.invalid_tax_id")}
        </FieldDescription>
      </Field>
      {text("legalRep", t("legalRep"), { maxLength: 200 })}

      {text("address", t("address"), { required: true, maxLength: 200 }, true)}
      <div className={cn("grid gap-3 sm:grid-cols-3", f.wide)}>
        <Field>
          <Label htmlFor="company-postalCode">{t("postalCode")}</Label>
          <Input
            id="company-postalCode"
            required
            inputMode="numeric"
            maxLength={5}
            className="num"
            value={draft.postalCode}
            aria-invalid={(draft.postalCode.length === 5 && !place) || undefined}
            onChange={(e) => setPostalCode(e.target.value)}
          />
        </Field>
        {text("city", t("city"), { required: true, maxLength: 200 })}
        {text("province", t("province"), { maxLength: 200 })}
      </div>

      <Field className={f.wide}>
        <span className="text-xs leading-none font-medium text-muted-foreground">{t("reaRegion")}</span>
        <div
          className={cn(
            "flex min-h-10 items-center gap-2.5 rounded-md px-3 text-sm font-semibold",
            place ? "bg-brand-soft text-brand-ink" : "bg-raise text-muted-foreground",
          )}
          aria-live="polite"
        >
          <MapPin aria-hidden className="size-4" />
          {place ? tr(`regions.${place.region}`) : t("reaRegionPending")}
        </div>
        <FieldDescription>{t("reaRegionHint")}</FieldDescription>
      </Field>

      {text("reaNumber", t("reaNumber"), { maxLength: 200 })}
      {text("phone", t("phone"), { type: "tel", maxLength: 20 })}
      {text("email", t("email"), { type: "email", maxLength: 200 })}
      {text("siteContact", t("siteContact"), { maxLength: 200 })}
      {text("siteContactPhone", t("siteContactPhone"), { type: "tel", maxLength: 20 })}
    </div>
  );
}
