"use client";

import { useTranslations } from "next-intl";
import styles from "./cardForm.module.css";

/** An error code from a card's action, translated from `<namespace>.<code>`. */
export default function FormError({ namespace, error }: { namespace: string; error?: string }) {
  const t = useTranslations(namespace);
  if (!error) return null;
  return (
    <p role="alert" className={styles.error}>
      {t(error)}
    </p>
  );
}
