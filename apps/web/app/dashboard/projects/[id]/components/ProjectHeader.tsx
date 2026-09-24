"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import type { ProjectWithRelations } from "../../../../actions/projects";
import { updateProject, deleteProject } from "../../../../actions/projects";
import shared from "../../../shared.module.css";
import styles from "../page.module.css";

const PHASE_COLORS: Record<string, string> = {
  showroom: "var(--verde-oliva)",
  budget: "var(--verde-oliva-light)",
  technical: "var(--verde-oliva-dark)",
  review: "var(--status-orange)",
  dossier: "var(--status-brown)",
  logistics: "var(--status-teal)",
  construction: "var(--status-blue)",
  certified: "var(--status-green)",
};

export default function ProjectHeader({
  project,
}: {
  project: ProjectWithRelations;
}) {
  const t = useTranslations("projectDetailPage");
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState({
    clientName: project.clientName,
    areaM2: project.areaM2,
    type: project.type,
    phase: project.phase,
    progressPct: project.progressPct,
    budgetTotal: project.budgetTotal,
    location: project.location,
    qualityLevel: project.qualityLevel,
    constructionWeekCurrent: project.constructionWeekCurrent ?? 0,
    constructionWeekTotal: project.constructionWeekTotal ?? 0,
    startDate: project.startDate ? project.startDate.toISOString().split("T")[0] : "",
    expectedDeliveryDate: project.expectedDeliveryDate ? project.expectedDeliveryDate.toISOString().split("T")[0] : "",
  });

  const phaseColor = PHASE_COLORS[project.phase] ?? "var(--admin-muted)";
  const budgetEuros = project.budgetTotal / 100;
  const invoicesPaid = project.invoices
    .filter((inv) => inv.status === "paid")
    .reduce((sum, inv) => sum + inv.amount, 0);
  const spentEuros = invoicesPaid / 100;

  async function handleSave() {
    await updateProject(project.id, {
      ...formData,
      startDate: formData.startDate || undefined,
      expectedDeliveryDate: formData.expectedDeliveryDate || undefined,
    });
    setEditing(false);
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm(t("header.confirmDelete"))) return;
    await deleteProject(project.id);
    router.push("/dashboard/projects");
  }

  if (editing) {
    return (
      <div className={styles.editForm}>
        <div className={styles.editField}>
          <label>Cliente</label>
          <input
            value={formData.clientName}
            onChange={(e) => setFormData({ ...formData, clientName: e.target.value })}
          />
        </div>
        <div className={styles.editField}>
          <label htmlFor="project-location">{t("header.address")}</label>
          <input
            id="project-location"
            value={formData.location}
            onChange={(e) => setFormData({ ...formData, location: e.target.value })}
          />
        </div>
        <div className={styles.editField}>
          <label>m²</label>
          <input
            type="number"
            value={formData.areaM2}
            onChange={(e) => setFormData({ ...formData, areaM2: parseInt(e.target.value, 10) || 0 })}
          />
        </div>
        <div className={styles.editField}>
          <label>{t("header.qualityLevel")}</label>
          <select
            value={formData.qualityLevel}
            onChange={(e) => setFormData({ ...formData, qualityLevel: e.target.value })}
          >
            <option value="standard">{t("qualityLevels.standard")}</option>
            <option value="premium">{t("qualityLevels.premium")}</option>
            <option value="luxury">{t("qualityLevels.luxury")}</option>
          </select>
        </div>
        <div className={styles.editField}>
          <label>{t("phases." + formData.phase)}</label>
          <select
            value={formData.phase}
            onChange={(e) => setFormData({ ...formData, phase: e.target.value as typeof formData.phase })}
          >
            {Object.keys(PHASE_COLORS).map((phase) => (
              <option key={phase} value={phase}>
                {t(`phases.${phase}`)}
              </option>
            ))}
          </select>
        </div>
        <div className={styles.editField}>
          <label>{t("header.budget")} (cents)</label>
          <input
            type="number"
            value={formData.budgetTotal}
            onChange={(e) => setFormData({ ...formData, budgetTotal: parseInt(e.target.value, 10) || 0 })}
          />
        </div>
        <div className={styles.editField}>
          <label>Progreso %</label>
          <input
            type="number"
            min={0}
            max={100}
            value={formData.progressPct}
            onChange={(e) => setFormData({ ...formData, progressPct: parseInt(e.target.value, 10) || 0 })}
          />
        </div>
        <div className={styles.editField}>
          <label>{t("header.startDate")}</label>
          <input
            type="date"
            value={formData.startDate}
            onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
          />
        </div>
        <div className={styles.editField}>
          <label>{t("header.delivery")}</label>
          <input
            type="date"
            value={formData.expectedDeliveryDate}
            onChange={(e) => setFormData({ ...formData, expectedDeliveryDate: e.target.value })}
          />
        </div>
        <div className={styles.editActions}>
          <button type="button" className={styles.btnDanger} onClick={handleDelete}>
            {t("header.delete")}
          </button>
          <button type="button" className={styles.btnSmall} onClick={() => setEditing(false)}>
            {t("header.cancel")}
          </button>
          <button type="button" className={styles.btnPrimary} onClick={handleSave}>
            {t("header.save")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.header}>
      <div className={styles.headerTop}>
        <div className={styles.headerIdentity}>
          <div className={styles.headerRef}>{project.ref}</div>
          <div className={styles.headerClient}>{project.clientName}</div>
          <div className={styles.headerSub}>
            {project.areaM2}m² {t(`types.${project.type}`)} · {project.location}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span
            className={shared.chip}
            style={{
              background: `color-mix(in srgb, ${phaseColor} 13%, transparent)`,
              color: phaseColor,
              fontSize: 12,
            }}
          >
            {t(`phases.${project.phase}`)}
          </span>
          <button type="button" className={styles.btnSmall} onClick={() => setEditing(true)}>
            {t("header.edit")}
          </button>
        </div>
      </div>

      {/* Progress bar */}
      <div className={styles.headerProgress} style={{ marginBottom: 16 }}>
        <div className={styles.headerProgressBar}>
          <div
            className={styles.headerProgressFill}
            style={{ width: `${project.progressPct}%`, background: phaseColor }}
          />
        </div>
        <div className={styles.headerProgressPct} style={{ color: phaseColor }}>
          {project.progressPct}%
        </div>
      </div>

      {/* Metadata row */}
      <div className={styles.headerMeta}>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>{t("header.budget")}</span>
          <span className={styles.metaValue}>
            €{budgetEuros.toLocaleString("es-ES")}
          </span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>{t("header.spent")}</span>
          <span className={styles.metaValue}>
            €{spentEuros.toLocaleString("es-ES")}
          </span>
        </div>
        {project.phase === "construction" && project.constructionWeekCurrent && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>Semana</span>
            <span className={styles.metaValue}>
              {t("header.week", {
                current: project.constructionWeekCurrent,
                total: project.constructionWeekTotal ?? "?",
              })}
            </span>
          </div>
        )}
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>{t("header.advisor")}</span>
          <span className={styles.metaValue}>{project.advisor?.name ?? "—"}</span>
        </div>
        <div className={styles.metaItem}>
          <span className={styles.metaLabel}>{t("header.qualityLevel")}</span>
          <span className={styles.metaValue}>{t(`qualityLevels.${project.qualityLevel}`)}</span>
        </div>
        {project.startDate && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t("header.startDate")}</span>
            <span className={styles.metaValue}>
              {project.startDate.toLocaleDateString("es-ES")}
            </span>
          </div>
        )}
        {project.expectedDeliveryDate && (
          <div className={styles.metaItem}>
            <span className={styles.metaLabel}>{t("header.delivery")}</span>
            <span className={styles.metaValue}>
              {project.expectedDeliveryDate.toLocaleDateString("es-ES")}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
