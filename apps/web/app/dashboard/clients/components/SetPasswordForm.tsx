"use client";

import { useTranslations } from "next-intl";
import type { ClientError, ClientListItem } from "@repo/core/contract";
import { displayName } from "./display";
import FormError from "./FormError";
import PasswordField from "./PasswordField";
import styles from "./clients.module.css";

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
    <form action={action} className={styles.card} aria-labelledby="password-form-title">
      <h2 id="password-form-title" className={styles.cardTitle}>
        {t("title", { name: displayName(client) })}
      </h2>
      <PasswordField id="client-new-password" label={t("password")} />
      <FormError error={error} />
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          {t("cancel")}
        </button>
        <button type="submit" className={styles.primary} disabled={pending}>
          {t("save")}
        </button>
      </div>
    </form>
  );
}
