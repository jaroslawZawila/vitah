"use client";

import { useTranslations } from "next-intl";
import styles from "./clients.module.css";

export default function ClientsHeader({
  count,
  created,
  onCreate,
}: {
  count: number;
  /** Shows the "client created" confirmation. */
  created: boolean;
  onCreate: () => void;
}) {
  const t = useTranslations("clientsPage");
  return (
    <>
      <div className={styles.header}>
        <h1 className={styles.title}>
          {t("title")}
          <span className={styles.count}>({count})</span>
        </h1>
        <button type="button" className={styles.primary} onClick={onCreate}>
          + {t("newClient")}
        </button>
      </div>
      {created && (
        <p role="status" className={styles.notice}>
          {t("created")}
        </p>
      )}
    </>
  );
}
