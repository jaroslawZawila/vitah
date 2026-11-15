"use client";

import { useTranslations } from "next-intl";
import type { ContactError, OfficeContact } from "@repo/core/contract";
import FormError from "../../components/FormError";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FieldDescription, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

const FIELDS = [
  { key: "address", type: "text", autoComplete: "street-address" },
  { key: "phone", type: "tel", autoComplete: "tel" },
  { key: "email", type: "email", autoComplete: "email" },
  { key: "hours", type: "text", autoComplete: "off" },
] as const;

/**
 * Presentational: the office the client's app shows on Contacto. Every field
 * is optional; a blank one is left off the app.
 */
export default function OfficeContactForm({
  office,
  onSubmit,
  pending,
  error,
  saved,
}: {
  office: OfficeContact;
  /** Gets the form (`address`, `phone`, `email`, `hours`); the fields keep what was typed whatever the result. */
  onSubmit: (form: FormData) => void;
  pending: boolean;
  error?: ContactError;
  saved: boolean;
}) {
  const t = useTranslations("officeContactPage");

  return (
    <>
      <h1>{t("title")}</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit(new FormData(event.currentTarget));
        }}
        className={cn(cardVariants(), "max-w-2xl")}
      >
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map(({ key, type, autoComplete }) => (
            <Field key={key}>
              <Label htmlFor={`office-${key}`}>{t(`fields.${key}`)}</Label>
              <Input
                id={`office-${key}`}
                name={key}
                type={type}
                autoComplete={autoComplete}
                maxLength={200}
                defaultValue={office[key] ?? ""}
                placeholder={t(`placeholders.${key}`)}
              />
            </Field>
          ))}
        </div>
        <FieldDescription>{t("hint")}</FieldDescription>
        <FormError namespace="officeContactPage.errors" error={error} />
        {saved && !pending && (
          <FormMessage tone="success" role="status">
            {t("saved")}
          </FormMessage>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" disabled={pending}>
            {pending ? t("saving") : t("save")}
          </Button>
        </div>
      </form>
    </>
  );
}
