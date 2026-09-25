"use client";

import { useFormatter, useTranslations } from "next-intl";
import type { ClientListItem } from "@repo/core/contract";
import { calendarDate, displayName } from "./display";
import shared from "../../shared.module.css";
import styles from "./clients.module.css";

/** Presentational: the clients table. */
export default function ClientList({
  clients,
  onSetPassword,
}: {
  clients: ClientListItem[];
  onSetPassword: (client: ClientListItem) => void;
}) {
  const t = useTranslations("clientsPage");
  const format = useFormatter();

  if (clients.length === 0) return <p className={shared.muted}>{t("empty")}</p>;

  const dash = "—";
  const date = (value: string | null) =>
    value ? format.dateTime(calendarDate(value), { dateStyle: "medium", timeZone: "UTC" }) : dash;

  return (
    <div className={styles.tableWrapper}>
      <table className={shared.table}>
        <thead>
          <tr>
            <th>{t("table.name")}</th>
            <th>{t("table.email")}</th>
            <th>{t("table.phone")}</th>
            <th>{t("table.dateOfBirth")}</th>
            <th>{t("table.address")}</th>
            <th>{t("table.status")}</th>
            <th>
              <span className={styles.srOnly}>{t("table.actions")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {clients.map((client) => (
            <tr key={client.id}>
              <td className={styles.name}>{displayName(client)}</td>
              <td className={styles.secondaryText}>{client.email}</td>
              <td className={styles.secondaryText}>{client.phone ?? dash}</td>
              <td className={styles.secondaryText}>{date(client.dateOfBirth)}</td>
              <td className={styles.secondaryText}>{client.address ?? dash}</td>
              <td>
                <span className={client.active ? shared.badgeGreen : shared.chip}>
                  {client.active ? t("statuses.active") : t("statuses.inactive")}
                </span>
              </td>
              <td>
                <button
                  type="button"
                  className={styles.secondary}
                  onClick={() => onSetPassword(client)}
                  aria-label={t("setPasswordFor", { name: displayName(client) })}
                >
                  {t("setPassword")}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
