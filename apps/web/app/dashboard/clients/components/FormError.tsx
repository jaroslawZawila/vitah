"use client";

import { useTranslations } from "next-intl";
import type { ClientError } from "@repo/core/contract";
import styles from "./clients.module.css";

export default function FormError({ error }: { error?: ClientError }) {
  const t = useTranslations("clientsPage.errors");
  if (!error) return null;
  return (
    <p role="alert" className={styles.error}>
      {t(error)}
    </p>
  );
}
