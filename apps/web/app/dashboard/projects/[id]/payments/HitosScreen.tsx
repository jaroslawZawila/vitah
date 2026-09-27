"use client";

// Container for the Payments tab: the only part that knows about server
// actions. The views in ../components/obra take props only.

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { ProjectObra } from "@repo/core/contract";
import { savePlanAction } from "../../../../actions/obra";
import Modal from "../components/Modal";
import { useObraFormat } from "../components/obra/format";
import HitoTable from "../components/obra/HitoTable";
import Kpi from "../components/obra/Kpi";
import styles from "../components/obra/obra.module.css";
import PlanForm from "../components/obra/PlanForm";
import { useObraAction } from "../components/obra/useObraAction";
import TabHeader from "../components/TabHeader";

/** The payment plan H0–H9: what is collected, due and still to invoice. */
export default function HitosScreen({
  projectId,
  projectRef,
  obra,
  canManage,
}: {
  projectId: string;
  projectRef: string;
  obra: ProjectObra;
  canManage: boolean;
}) {
  const t = useTranslations("obra.payments");
  const f = useObraFormat();
  const [planOpen, setPlanOpen] = useState(false);
  const { state, pending, run, reset } = useObraAction();
  const total = obra.budget?.totalCents ?? 0;
  const { hitos } = obra;
  const count = (status: string) => hitos.filter((h) => h.status === status).length;
  const invoiced = hitos.find((h) => h.status === "invoiced");

  return (
    <div className={styles.stack}>
      <TabHeader
        projectRef={projectRef}
        title={t("title")}
        summary={obra.budget ? t("summary", { total: f.money(total) }) : t("noBudget")}
        action={
          canManage && (
            <button
              type="button"
              className={styles.button}
              onClick={() => {
                reset();
                setPlanOpen(true);
              }}
            >
              {t("editPlan")}
            </button>
          )
        }
      />
      <section className={styles.kpis3}>
        <Kpi
          label={t("collected")}
          value={f.money(obra.paidCents)}
          hints={[t("collectedHint", { count: count("paid"), pct: f.ratio(obra.paidCents, total) })]}
        />
        <Kpi
          label={t("invoiced")}
          value={f.money(obra.invoicedUnpaidCents)}
          hints={[
            invoiced?.dueOn
              ? t("invoicedHint", { code: invoiced.code, date: f.date(invoiced.dueOn) })
              : t("nothingDue"),
          ]}
        />
        <Kpi
          label={t("toInvoice")}
          value={f.money(obra.toInvoiceCents)}
          hints={[
            t("toInvoiceHint", {
              count: hitos.length - count("paid") - count("invoiced"),
              pct: f.ratio(obra.toInvoiceCents, total),
            }),
          ]}
        />
      </section>
      {obra.planPctBp !== 10_000 && hitos.length > 0 && (
        <p role="status" className={styles.warning}>
          {t("pctWarning", { pct: f.share(obra.planPctBp) })}
        </p>
      )}
      <section className={styles.card}>
        <HitoTable
          hitos={hitos}
          totalCents={total}
          hitoHref={(hito) => `/dashboard/projects/${projectId}/payments/${hito.id}`}
        />
      </section>
      <p className={styles.muted}>
        <strong>{t("pipelineLabel")}</strong> {t("pipeline")}
      </p>
      {canManage && (
        <Modal open={planOpen} onOpenChange={setPlanOpen} title={t("planTitle")}>
          <PlanForm
            hitos={hitos}
            onSubmit={(changes) => run(() => savePlanAction(projectId, changes), () => setPlanOpen(false))}
            onCancel={() => setPlanOpen(false)}
            pending={pending}
            error={state?.error}
          />
        </Modal>
      )}
    </div>
  );
}
