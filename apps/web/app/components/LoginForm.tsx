"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { loginAction } from "../actions/auth";
import styles from "./LoginForm.module.css";

export function LoginForm() {
  const t = useTranslations("login");
  const [state, formAction, isPending] = useActionState(loginAction, null);

  return (
    <form action={formAction} className={styles.form}>
      <div className={styles.field}>
        <label htmlFor="email" className={styles.label}>
          {t("emailLabel")}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          placeholder={t("emailPlaceholder")}
          className={styles.input}
          autoComplete="email"
        />
      </div>

      <div className={styles.field}>
        <label htmlFor="password" className={styles.label}>
          {t("passwordLabel")}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          placeholder={t("passwordPlaceholder")}
          className={styles.input}
          autoComplete="current-password"
        />
      </div>

      <button type="submit" disabled={isPending} className={styles.button}>
        {isPending ? t("submitting") : t("submit")}
      </button>

      {state?.error && (
        <p className={styles.error}>
          {t(state.error === "too_many_attempts" ? "tooManyAttempts" : "error")}
        </p>
      )}
    </form>
  );
}
