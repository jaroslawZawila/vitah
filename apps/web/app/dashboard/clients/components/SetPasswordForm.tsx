"use client";

import { useTranslations } from "next-intl";
import type { ClientError, ClientListItem } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { FormActions } from "@/components/ui/field";
import FormError from "../../components/FormError";
import { displayName } from "./display";
import PasswordField from "./PasswordField";

/** Presentational: sets the password a client signs in to the app with. */
export default function SetPasswordForm({
  client,
  action,
  pending,
  error,
  onCancel,
}: {
  client: ClientListItem;
  action: (formData: FormData) => void;
  pending: boolean;
  error?: ClientError;
  onCancel: () => void;
}) {
  const t = useTranslations("clientsPage.passwordForm");

  return (
    <form action={action} className={cardVariants()} aria-labelledby="password-form-title">
      <h2 id="password-form-title">{t("title", { name: displayName(client) })}</h2>
      <PasswordField id="client-new-password" label={t("password")} />
      <FormError namespace="clientsPage.errors" error={error} />
      <FormActions>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t("cancel")}
        </Button>
        <Button type="submit" disabled={pending}>
          {t("save")}
        </Button>
      </FormActions>
    </form>
  );
}
