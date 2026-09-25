"use client";

import { useTranslations } from "next-intl";
import type { ClientError } from "@repo/core/contract";
import FormError from "./FormError";
import PasswordField from "./PasswordField";
import styles from "./clients.module.css";

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
    <form action={action} className={styles.card} aria-labelledby="client-form-title">
      <h2 id="client-form-title" className={styles.cardTitle}>
        {t("title")}
      </h2>
      <div className={styles.grid}>
        <div className={styles.field}>
          <label htmlFor="client-first-name">{t("firstName")}</label>
          <input id="client-first-name" name="firstName" required autoComplete="off" />
        </div>
        <div className={styles.field}>
          <label htmlFor="client-surnames">{t("surnames")}</label>
          <input id="client-surnames" name="surnames" required autoComplete="off" />
        </div>
        <div className={styles.field}>
          <label htmlFor="client-dob">{t("dateOfBirth")}</label>
          <input id="client-dob" name="dateOfBirth" type="date" max={today} />
        </div>
        <div className={styles.field}>
          <label htmlFor="client-phone">{t("phone")}</label>
          <input
            id="client-phone"
            name="phone"
            type="tel"
            autoComplete="off"
            placeholder={t("phonePlaceholder")}
          />
        </div>
        <div className={`${styles.field} ${styles.wide}`}>
          <label htmlFor="client-address">{t("address")}</label>
          <input id="client-address" name="address" autoComplete="off" />
        </div>
        <div className={styles.field}>
          <label htmlFor="client-email">{t("email")}</label>
          <input id="client-email" name="email" type="email" required autoComplete="off" />
        </div>
        <PasswordField id="client-password" label={t("password")} />
      </div>
      <FormError error={error} />
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} onClick={onCancel}>
          {t("cancel")}
        </button>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? t("creating") : t("create")}
        </button>
      </div>
    </form>
  );
}
