"use client";

import Link from "next/link";
import { useFormatter, useTranslations } from "next-intl";
import shared from "../shared.module.css";
import styles from "./page.module.css";

type Project = {
  id: string;
  ref: string;
  address: string;
  startDate: Date | null;
  completionDate: Date | null;
  client: { id: string; name: string | null; email: string } | null;
};

export default function ProjectsListClient({
  projects,
}: {
  projects: Project[];
}) {
  const t = useTranslations("projectsPage");
  const format = useFormatter();
  // Calendar dates are stored at UTC midnight.
  const formatDate = (date: Date | null) =>
    date
      ? format.dateTime(date, { dateStyle: "medium", timeZone: "UTC" })
      : "—";

  return (
    <>
      <div className={styles.filters}>
        <span className={styles.count}>
          {t("count", { count: projects.length })}
        </span>
        <Link href="/dashboard/projects/new" className={styles.newProjectBtn}>
          + {t("newProject")}
        </Link>
      </div>

      {projects.length === 0 ? (
        <p className={shared.muted}>{t("empty")}</p>
      ) : (
        <div className={styles.tableWrapper}>
          <table className={shared.table}>
            <thead>
              <tr>
                <th>{t("table.ref")}</th>
                <th>{t("table.address")}</th>
                <th>{t("table.client")}</th>
                <th>{t("table.startDate")}</th>
                <th>{t("table.completionDate")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {projects.map((p) => (
                <tr key={p.id}>
                  <td style={{ fontWeight: 600, color: "var(--verde-oliva)" }}>
                    {p.ref}
                  </td>
                  <td>{p.address}</td>
                  <td style={{ color: "#6b6b6b" }}>
                    {p.client
                      ? (p.client.name ?? p.client.email)
                      : t("table.noClient")}
                  </td>
                  <td style={{ color: "#6b6b6b" }}>
                    {formatDate(p.startDate)}
                  </td>
                  <td style={{ color: "#6b6b6b" }}>
                    {formatDate(p.completionDate)}
                  </td>
                  <td>
                    <Link
                      href={`/dashboard/projects/${p.id}`}
                      className={styles.viewBtn}
                    >
                      {t("table.view")}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
