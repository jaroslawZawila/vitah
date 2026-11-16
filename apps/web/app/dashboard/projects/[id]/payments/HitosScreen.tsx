"use client";

// Container for the Payments tab: the only part that knows about server
// actions. The views in ../components/obra take props only.

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Hito, ProjectObra } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { savePlanAction } from "../../../../actions/obra";
import Modal from "../components/Modal";
import { muted } from "../components/obra/classes";
import { useObraFormat } from "../components/obra/format";
import HitoTable, { HitoCards } from "../components/obra/HitoTable";
import Kpi from "../components/obra/Kpi";
import PlanForm from "../components/obra/PlanForm";
import { useObraAction } from "../components/obra/useObraAction";
import { useVatLabel } from "../../../components/vat-basis";
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
  const vat = useVatLabel();
  const [planOpen, setPlanOpen] = useState(false);
  const { state, pending, run, reset } = useObraAction();
  const total = obra.budget?.totalCents ?? 0;
  const { hitos } = obra;
  const count = (status: string) => hitos.filter((h) => h.status === status).length;
  const invoiced = hitos.find((h) => h.status === "invoiced");
  const hitoHref = (hito: Hito) => `/dashboard/projects/${projectId}/payments/${hito.id}`;

  return (
    <div className="flex flex-col gap-5">
      <TabHeader
        projectRef={projectRef}
        title={t("title")}
        summary={obra.budget ? t("summary", { total: f.money(total) }) : t("noBudget")}
        action={
          canManage && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                reset();
                setPlanOpen(true);
              }}
            >
              {t("editPlan")}
            </Button>
          )
        }
      />
      <section className="grid gap-3.5 md:grid-cols-3">
        <Kpi
          highlight
          label={vat(t("collected"), "excl")}
          value={f.money(obra.paidCents)}
          hints={[t("collectedHint", { count: count("paid"), pct: f.ratio(obra.paidCents, total) })]}
        />
        <Kpi
          label={vat(t("invoiced"), "excl")}
          value={f.money(obra.invoicedUnpaidCents)}
          hints={[
            invoiced?.dueOn
              ? t("invoicedHint", { code: invoiced.code, date: f.date(invoiced.dueOn) })
              : t("nothingDue"),
          ]}
        />
        <Kpi
          label={vat(t("toInvoice"), "excl")}
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
        <p role="status" className="rounded-lg bg-warn-soft px-3.5 py-[11px] text-sm text-warn">
          {t("pctWarning", { pct: f.share(obra.planPctBp) })}
        </p>
      )}
      <section className={cn(cardVariants(), "max-md:hidden")}>
        <HitoTable hitos={hitos} totalCents={total} hitoHref={hitoHref} />
      </section>
      <HitoCards className="md:hidden" hitos={hitos} totalCents={total} hitoHref={hitoHref} />
      <p className={muted}>
        <strong className="font-semibold text-foreground">{t("pipelineLabel")}</strong> {t("pipeline")}
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
