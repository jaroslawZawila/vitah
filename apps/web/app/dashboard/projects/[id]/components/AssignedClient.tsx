"use client";

import { useTranslations } from "next-intl";
import type { ClientOption, ProjectClientError } from "@repo/core/contract";
import FormError from "./FormError";
import styles from "./ClientAccessCard.module.css";

/** Presentational: the client attached to the project. */
export default function AssignedClient({
  client,
  onRemove,
  removing,
  error,
}: {
  client: ClientOption;
  onRemove: () => void;
  removing: boolean;
  error?: ProjectClientError;
}) {
  const t = useTranslations("projectDetailPage.clientAccess");

  return (
    <div className={styles.attached}>
      <div className={styles.identity}>
        <span className={styles.status}>{t("active")}</span>
        <span className={styles.clientName}>{client.name ?? client.email}</span>
        <span className={styles.clientEmail}>{client.email}</span>
      </div>
      <FormError namespace="projectDetailPage.clientAccess.errors" error={error} />
      <div className={styles.actions}>
        <button type="button" className={styles.danger} onClick={onRemove} disabled={removing}>
          {t("remove")}
        </button>
      </div>
    </div>
  );
}
