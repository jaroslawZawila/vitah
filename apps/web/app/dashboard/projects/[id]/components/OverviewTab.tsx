"use client";

import { useTranslations } from "next-intl";
import type { ProjectWithRelations } from "../../../../actions/projects";
import ClientAccessCard from "./ClientAccessCard";
import shared from "../../../shared.module.css";
import styles from "../page.module.css";

const PHASES = [
  "showroom",
  "budget",
  "technical",
  "review",
  "dossier",
  "logistics",
  "construction",
  "certified",
] as const;

export default function OverviewTab({
  project,
  canManageClient,
}: {
  project: ProjectWithRelations;
  canManageClient: boolean;
}) {
  const t = useTranslations("projectDetailPage");

  const currentPhaseIndex = PHASES.indexOf(project.phase);

  const daysRemaining = project.expectedDeliveryDate
    ? Math.max(
        0,
        Math.ceil(
          (project.expectedDeliveryDate.getTime() - Date.now()) /
            (1000 * 60 * 60 * 24),
        ),
      )
    : null;

  // Find alerts: overdue tasks, overdue invoices, failed QC
  const alerts: { type: string; message: string }[] = [];
  for (const task of project.tasks) {
    if (task.dueDate && task.dueDate < new Date() && task.status !== "completed") {
      alerts.push({ type: "task", message: `Tarea vencida: ${task.title}` });
    }
  }
  for (const inv of project.invoices) {
    if (inv.status === "overdue") {
      alerts.push({ type: "invoice", message: `Factura vencida: ${inv.description ?? "—"}` });
    }
  }
  for (const qc of project.qualityChecks) {
    if (qc.result === "fail") {
      alerts.push({ type: "qc", message: `QC fallido: ${qc.name}` });
    }
  }

  // Upcoming deadlines: nearest due tasks + invoices
  const upcoming: { label: string; date: Date }[] = [];
  for (const task of project.tasks) {
    if (task.dueDate && task.dueDate > new Date() && task.status !== "completed") {
      upcoming.push({ label: task.title, date: task.dueDate });
    }
  }
  for (const inv of project.invoices) {
    if (inv.dueDate > new Date() && inv.status !== "paid") {
      upcoming.push({ label: `Factura: ${inv.description ?? "—"}`, date: inv.dueDate });
    }
  }
  upcoming.sort((a, b) => a.date.getTime() - b.date.getTime());

  return (
    <>
      {/* Pipeline visualizer */}
      <div className={`${shared.card} ${shared.mb16}`}>
        <div className={shared.cardTitle}>{t("overview.pipeline")}</div>
        <div className={styles.pipeline}>
          {PHASES.map((phase, i) => {
            const className =
              i === currentPhaseIndex
                ? styles.pipelineStepActive
                : i < currentPhaseIndex
                  ? styles.pipelineStepDone
                  : styles.pipelineStep;
            return (
              <div key={phase} className={className}>
                {t(`phases.${phase}`)}
              </div>
            );
          })}
        </div>
      </div>

      {canManageClient && (
        <div className={shared.mb16}>
          <ClientAccessCard projectId={project.id} client={project.client} />
        </div>
      )}

      <div className={shared.grid2}>
        {/* Key Dates */}
        <div className={shared.card}>
          <div className={shared.cardTitle}>{t("overview.keyDates")}</div>
          {project.startDate && (
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              <span style={{ color: "var(--admin-muted)" }}>{t("overview.startDate")}:</span>{" "}
              <strong>{project.startDate.toLocaleDateString("es-ES")}</strong>
            </div>
          )}
          {project.expectedDeliveryDate && (
            <div style={{ fontSize: 12, marginBottom: 8 }}>
              <span style={{ color: "var(--admin-muted)" }}>{t("overview.expectedDelivery")}:</span>{" "}
              <strong>{project.expectedDeliveryDate.toLocaleDateString("es-ES")}</strong>
            </div>
          )}
          {daysRemaining !== null && (
            <div style={{ fontSize: 12 }}>
              <strong style={{ color: "var(--verde-oliva)", fontSize: 18 }}>{daysRemaining}</strong>{" "}
              <span style={{ color: "var(--admin-muted)" }}>{t("overview.daysRemaining")}</span>
            </div>
          )}
        </div>

        {/* Alerts */}
        <div className={shared.card}>
          <div className={shared.cardTitle}>{t("overview.alerts")}</div>
          {alerts.length === 0 ? (
            <div className={shared.muted}>{t("overview.noAlerts")}</div>
          ) : (
            alerts.map((alert, i) => (
              <div
                key={i}
                style={{
                  fontSize: 12,
                  padding: "6px 0",
                  borderBottom:
                    i < alerts.length - 1 ? "1px solid var(--admin-separator)" : "none",
                  color: "var(--error)",
                }}
              >
                {alert.message}
              </div>
            ))
          )}
        </div>
      </div>

      <div className={`${shared.grid2}`} style={{ marginTop: 12 }}>
        {/* Recent Activity */}
        <div className={shared.card}>
          <div className={shared.cardTitle}>{t("overview.recentActivity")}</div>
          {project.activityLog.length === 0 ? (
            <div className={shared.muted}>{t("overview.noActivity")}</div>
          ) : (
            project.activityLog.slice(0, 10).map((activity) => (
              <div key={activity.id} className={styles.activityItem}>
                <div className={styles.activityDot} />
                <div className={styles.activityDetail}>
                  {activity.detail}
                </div>
                <div className={styles.activityDate}>
                  {activity.createdAt.toLocaleDateString("es-ES")}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Upcoming Deadlines */}
        <div className={shared.card}>
          <div className={shared.cardTitle}>{t("overview.upcomingDeadlines")}</div>
          {upcoming.length === 0 ? (
            <div className={shared.muted}>—</div>
          ) : (
            upcoming.slice(0, 5).map((item, i) => (
              <div
                key={i}
                style={{
                  fontSize: 12,
                  padding: "6px 0",
                  borderBottom:
                    i < Math.min(upcoming.length, 5) - 1
                      ? "1px solid var(--admin-separator)"
                      : "none",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>{item.label}</span>
                <span className={shared.muted}>
                  {item.date.toLocaleDateString("es-ES")}
                </span>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );
}
