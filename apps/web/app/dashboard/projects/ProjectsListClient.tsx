"use client";

import { useState, useActionState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { createProject, type ProjectFormState } from "../../actions/projects";
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
  const router = useRouter();
  const [showForm, setShowForm] = useState(false);

  const [state, formAction, isPending] = useActionState(
    async (prev: ProjectFormState, formData: FormData) => {
      const result = await createProject(prev, formData);
      if (result?.success && result.id) {
        setShowForm(false);
        router.push(`/dashboard/projects/${result.id}`);
      }
      return result;
    },
    null,
  );

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
        <button
          type="button"
          className={styles.newProjectBtn}
          onClick={() => setShowForm(!showForm)}
        >
          + {t("newProject")}
        </button>
      </div>

      {showForm && (
        <form action={formAction} className={styles.createForm}>
          <div className={styles.createField}>
            <label htmlFor="new-ref">{t("createForm.ref")}</label>
            <input
              id="new-ref"
              name="ref"
              required
              placeholder={t("createForm.refPlaceholder")}
            />
          </div>
          <div className={styles.createField}>
            <label htmlFor="new-address">{t("createForm.address")}</label>
            <input
              id="new-address"
              name="address"
              required
              placeholder={t("createForm.addressPlaceholder")}
            />
          </div>
          <div className={styles.createField}>
            <label htmlFor="new-start">{t("createForm.startDate")}</label>
            <input id="new-start" name="startDate" type="date" />
          </div>
          <div className={styles.createField}>
            <label htmlFor="new-completion">
              {t("createForm.completionDate")}
            </label>
            <input id="new-completion" name="completionDate" type="date" />
          </div>
          <div className={styles.createActions}>
            <button
              type="submit"
              className={styles.createSubmit}
              disabled={isPending}
            >
              {isPending ? "..." : t("createForm.create")}
            </button>
            <button
              type="button"
              className={styles.createCancel}
              onClick={() => setShowForm(false)}
            >
              {t("createForm.cancel")}
            </button>
            {state?.error && (
              <span role="alert" className={styles.createError}>
                {t(`createForm.errors.${state.error}`)}
              </span>
            )}
          </div>
        </form>
      )}

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
