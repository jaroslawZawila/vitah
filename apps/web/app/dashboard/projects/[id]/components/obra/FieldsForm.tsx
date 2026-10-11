"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Field as FieldBox, FieldDescription, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import FormError from "../../../../components/FormError";

export type Field = {
  name: string;
  label: string;
  multiline?: boolean;
  defaultValue?: string;
  hint?: string;
  required?: boolean;
  inputMode?: "decimal" | "numeric" | "text";
};

/** Presentational: a small form of labelled fields, submitted as strings (shown in a modal). */
export default function FieldsForm({
  fields,
  onSubmit,
  onCancel,
  pending,
  error,
}: {
  fields: Field[];
  onSubmit: (values: Record<string, string>) => void;
  onCancel: () => void;
  pending: boolean;
  error?: string;
}) {
  const t = useTranslations("obra.budget.form");
  const id = useId();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSubmit(Object.fromEntries(fields.map((f) => [f.name, String(data.get(f.name) ?? "").trim()])));
      }}
    >
      {fields.map((field) => {
        const fieldId = `${id}-${field.name}`;
        return (
          <FieldBox key={field.name}>
            <Label htmlFor={fieldId}>{field.label}</Label>
            {field.multiline ? (
              <Textarea id={fieldId} name={field.name} defaultValue={field.defaultValue} rows={5} />
            ) : (
              <Input
                id={fieldId}
                name={field.name}
                type="text"
                inputMode={field.inputMode}
                defaultValue={field.defaultValue}
                required={field.required}
              />
            )}
            {field.hint && <FieldDescription>{field.hint}</FieldDescription>}
          </FieldBox>
        );
      })}
      <FormError namespace="obra.errors" error={error} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("saving") : t("save")}
        </Button>
      </FormActions>
    </form>
  );
}
