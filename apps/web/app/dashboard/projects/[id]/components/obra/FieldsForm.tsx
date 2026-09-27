"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import formStyles from "../cardForm.module.css";
import FormError from "../FormError";

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
      className={formStyles.form}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        onSubmit(Object.fromEntries(fields.map((f) => [f.name, String(data.get(f.name) ?? "").trim()])));
      }}
    >
      {fields.map((field) => {
        const fieldId = `${id}-${field.name}`;
        return (
          <div key={field.name} className={formStyles.field}>
            <label htmlFor={fieldId}>{field.label}</label>
            {field.multiline ? (
              <textarea id={fieldId} name={field.name} defaultValue={field.defaultValue} rows={5} />
            ) : (
              <input
                id={fieldId}
                name={field.name}
                type="text"
                inputMode={field.inputMode}
                defaultValue={field.defaultValue}
                required={field.required}
              />
            )}
            {field.hint && <span className={formStyles.hint}>{field.hint}</span>}
          </div>
        );
      })}
      <FormError namespace="obra.errors" error={error} />
      <div className={formStyles.actions}>
        <button type="button" className={formStyles.secondary} onClick={onCancel}>
          {t("cancel")}
        </button>
        <button type="submit" className={formStyles.primary} disabled={pending}>
          {pending ? t("saving") : t("save")}
        </button>
      </div>
    </form>
  );
}
