"use client";

import { useState, useTransition } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { ProjectDetail } from "../../../../actions/projects";
import { updateProject, deleteProject } from "../../../../actions/projects";
import styles from "../page.module.css";

/** Dates are calendar dates stored at UTC midnight. */
function toInputDate(date: Date | null): string {
  return date ? date.toISOString().slice(0, 10) : "";
}

export default function ProjectHeader({ project }: { project: ProjectDetail }) {
  const t = useTranslations("projectDetailPage.header");
  const format = useFormatter();
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [form, setForm] = useState({
    address: project.address,
    startDate: toInputDate(project.startDate),
    completionDate: toInputDate(project.completionDate),
  });

  function formatDate(date: Date | null) {
    return date
      ? format.dateTime(date, { dateStyle: "long", timeZone: "UTC" })
      : t("notSet");
  }

  function handleSave() {
    startTransition(async () => {
      const result = await updateProject(project.id, form);
      if (result?.error) {
        setError(result.error);
        return;
      }
      setError(null);
      setEditing(false);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm(t("confirmDelete"))) return;
    startTransition(async () => {
      await deleteProject(project.id);
      router.push("/dashboard/projects");
    });
  }

  if (editing) {
    return (
      <div className={styles.editForm}>
        <div className={styles.editField}>
          <label htmlFor="project-address">{t("address")}</label>
          <input
            id="project-address"
            value={form.address}
            onChange={(e) => setForm({ ...form, address: e.target.value })}
          />
        </div>
        <div className={styles.editField}>
          <label htmlFor="project-start">{t("startDate")}</label>
          <input
            id="project-start"
            type="date"
            value={form.startDate}
            onChange={(e) => setForm({ ...form, startDate: e.target.value })}
          />
        </div>
        <div className={styles.editField}>
          <label htmlFor="project-completion">{t("completionDate")}</label>
          <input
            id="project-completion"
            type="date"
            value={form.completionDate}
            onChange={(e) =>
              setForm({ ...form, completionDate: e.target.value })
            }
          />
        </div>
        {error && (
          <p role="alert" className={styles.error}>
            {t(`errors.${error}`)}
          </p>
        )}
        <div className={styles.editActions}>
          <button
            type="button"
            className={styles.btnDanger}
            onClick={handleDelete}
            disabled={isPending}
          >
            {t("delete")}
          </button>
          <button
            type="button"
            className={styles.btnSmall}
            onClick={() => {
              setEditing(false);
              setError(null);
            }}
          >
            {t("cancel")}
          </button>
          <button
            type="button"
            className={styles.btnPrimary}
            onClick={handleSave}
            disabled={isPending}
          >
            {t("save")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.header}>
      <div className={styles.headerTop}>
        <div>
          <div className={styles.headerRef}>{project.ref}</div>
          <div className={styles.headerSub}>{project.address}</div>
        </div>
        <button
          type="button"
          className={styles.btnSmall}
          onClick={() => setEditing(true)}
        >
          {t("edit")}
        </button>
      </div>

      <dl className={styles.headerMeta}>
        <div className={styles.metaItem}>
          <dt className={styles.metaLabel}>{t("startDate")}</dt>
          <dd className={styles.metaValue}>{formatDate(project.startDate)}</dd>
        </div>
        <div className={styles.metaItem}>
          <dt className={styles.metaLabel}>{t("completionDate")}</dt>
          <dd className={styles.metaValue}>
            {formatDate(project.completionDate)}
          </dd>
        </div>
      </dl>
    </div>
  );
}
