"use client";

import { useTranslations } from "next-intl";
import type { ClientError } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import FormError from "../../components/FormError";
import PasswordField from "./PasswordField";

/** Presentational: the new-client form. Submits to `action`. */
export default function ClientForm({
  action,
  pending,
  error,
  onCancel,
}: {
  action: (formData: FormData) => void;
  pending: boolean;
  error?: ClientError;
  onCancel: () => void;
}) {
  const t = useTranslations("clientsPage.form");
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form
      action={action}
      className={cardVariants()}
      aria-labelledby="client-form-title"
    >
      <h2 id="client-form-title">{t("title")}</h2>
      <div className="grid gap-3 md:grid-cols-2">
        <Field>
          <Label htmlFor="client-first-name">{t("firstName")}</Label>
          <Input id="client-first-name" name="firstName" required autoComplete="off" />
        </Field>
        <Field>
          <Label htmlFor="client-surnames">{t("surnames")}</Label>
          <Input id="client-surnames" name="surnames" required autoComplete="off" />
        </Field>
        <Field>
          <Label htmlFor="client-dob">{t("dateOfBirth")}</Label>
          <Input id="client-dob" name="dateOfBirth" type="date" max={today} />
        </Field>
        <Field>
          <Label htmlFor="client-phone">{t("phone")}</Label>
          <Input
            id="client-phone"
            name="phone"
            type="tel"
            autoComplete="off"
            placeholder={t("phonePlaceholder")}
          />
        </Field>
        <Field className="md:col-span-2">
          <Label htmlFor="client-address">{t("address")}</Label>
          <Input id="client-address" name="address" autoComplete="off" />
        </Field>
        <Field>
          <Label htmlFor="client-email">{t("email")}</Label>
          <Input id="client-email" name="email" type="email" required autoComplete="off" />
        </Field>
        <PasswordField id="client-password" label={t("password")} />
      </div>
      <FormError namespace="clientsPage.errors" error={error} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? t("creating") : t("create")}
        </Button>
      </FormActions>
    </form>
  );
}
