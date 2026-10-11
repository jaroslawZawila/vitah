"use client";

import { useTranslations } from "next-intl";
import { MIN_PASSWORD_LENGTH } from "@repo/core/contract";
import { Field, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function PasswordField({ id, label }: { id: string; label: string }) {
  const t = useTranslations("clientsPage.form");
  return (
    <Field>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name="password"
        type="password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
      />
      <FieldDescription>{t("passwordHint", { min: MIN_PASSWORD_LENGTH })}</FieldDescription>
    </Field>
  );
}
