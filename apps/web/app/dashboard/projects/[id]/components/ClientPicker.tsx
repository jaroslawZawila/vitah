"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ClientOption, ProjectClientError } from "@repo/core/contract";
import ClientAccessError from "./ClientAccessError";
import styles from "./ClientAccessCard.module.css";

/** Presentational: pick an existing client for the project. */
export default function ClientPicker({
  clients,
  action,
  pending,
  error,
}: {
  clients: ClientOption[];
  action: (formData: FormData) => void;
  pending: boolean;
  error?: ProjectClientError;
}) {
  const t = useTranslations("projectDetailPage.clientAccess");

  if (clients.length === 0) {
    return (
      <p className={styles.intro}>
        {t.rich("noClients", {
          link: (chunks) => (
            <Link href="/dashboard/clients" className={styles.link}>
              {chunks}
            </Link>
          ),
        })}
      </p>
    );
  }

  return (
    <form action={action} className={styles.form}>
      <p className={styles.intro}>{t("intro")}</p>
      <div className={styles.field}>
        <label htmlFor="client-id">{t("client")}</label>
        <select id="client-id" name="clientId" required defaultValue="">
          <option value="" disabled>
            {t("choose")}
          </option>
          {clients.map((client) => (
            <option key={client.id} value={client.id}>
              {client.name ? `${client.name} — ${client.email}` : client.email}
            </option>
          ))}
        </select>
      </div>
      <ClientAccessError error={error} />
      <div className={styles.actions}>
        <button type="submit" className={styles.primary} disabled={pending}>
          {pending ? t("assigning") : t("assign")}
        </button>
      </div>
    </form>
  );
}
