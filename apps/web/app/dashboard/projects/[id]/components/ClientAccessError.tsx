"use client";

import { useTranslations } from "next-intl";
import type { ProjectClientError } from "@repo/core/contract";
import styles from "./ClientAccessCard.module.css";

export default function ClientAccessError({ error }: { error?: ProjectClientError }) {
  const t = useTranslations("projectDetailPage.clientAccess.errors");
  if (!error) return null;
  return (
    <p role="alert" className={styles.error}>
      {t(error)}
    </p>
  );
}
