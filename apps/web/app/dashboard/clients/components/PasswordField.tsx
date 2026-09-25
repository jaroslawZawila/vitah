"use client";

import { useTranslations } from "next-intl";
import { MIN_PASSWORD_LENGTH } from "@repo/core/contract";
import styles from "./clients.module.css";

export default function PasswordField({ id, label }: { id: string; label: string }) {
  const t = useTranslations("clientsPage.form");
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name="password"
        type="password"
        required
        minLength={MIN_PASSWORD_LENGTH}
        autoComplete="new-password"
      />
      <span className={styles.hint}>{t("passwordHint", { min: MIN_PASSWORD_LENGTH })}</span>
    </div>
  );
}
