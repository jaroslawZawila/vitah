"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { MIN_PASSWORD_LENGTH } from "@repo/core/contract";
import { Field, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Presentational: the field where a password is set, for anyone (a new user or
 * client, a reset, changing one's own), with the one policy under it and an
 * optional `hint` after that.
 */
export default function NewPasswordField({
  label,
  name = "password",
  hint,
}: {
  label: string;
  name?: string;
  hint?: string;
}) {
  const t = useTranslations("account");
  const id = useId();
  return (
    <Field>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        name={name}
        type="password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
        aria-describedby={`${id}-policy`}
      />
      <FieldDescription id={`${id}-policy`}>
        {t("passwordPolicy", { min: MIN_PASSWORD_LENGTH })}
        {hint && ` ${hint}`}
      </FieldDescription>
    </Field>
  );
}
