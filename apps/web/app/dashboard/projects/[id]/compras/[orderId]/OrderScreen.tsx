"use client";

// Container for an order's page: the only part of it that knows about server
// actions (status, PDF). The views in ../../components/purchasing take props only.

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import {
  canCancel,
  countsAsContracted,
  isCompletedOrder,
  nextStatus,
  orderLabel,
  type PurchaseOrderDetail,
  type PurchaseStatus,
} from "@repo/core/contract";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  addOrderDocumentAction,
  addOrderDocumentVersionAction,
  deleteOrderDocumentAction,
  setPurchaseStatusAction,
} from "../../../../../actions/purchasing";
import { setOrderMilestonesAction } from "../../../../../actions/purchase-invoices";
import FormError from "../../../../components/FormError";
import { obraHref } from "../../components/construction/ObraFrame";
import { useObraAction } from "../../components/obra/useObraAction";
import { editOrderHref, newInvoiceHref, orderDocumentUrl, purchasesHref } from "../../components/purchasing/links";
import { OrderDocuments } from "../../components/purchasing/OrderDocumentViews";
import { MilestonesCard, OrderInvoices } from "../../components/purchasing/OrderInvoiceViews";
import { LateBanner, OrderData, OrderHeading, OrderHistory, OrderLines, StatusForm, StatusSteps } from "../../components/purchasing/OrderViews";
import BackLink from "../../../../components/BackLink";

/** One order: where it stands, its lines against the budget, its data and history. */
export default function OrderScreen({
  projectId,
  order,
  canManage,
}: {
  projectId: string;
  order: PurchaseOrderDetail;
  canManage: boolean;
}) {
  const t = useTranslations("purchasing.order");
  const status = useObraAction();
  const file = useObraAction();
  const schedule = useObraAction();
  // Invoices go only to a placed order; the form lives in Compras › Facturas.
  const registerHref = canManage && countsAsContracted(order.status) ? newInvoiceHref({ orderId: order.id }) : undefined;
  const [dated, setDated] = useState<PurchaseStatus | null>(null);
  const next = nextStatus(order.kind, order.status);

  function advance(to: PurchaseStatus) {
    status.reset();
    // Completing records the day it happened (≤ today): a form first.
    if (isCompletedOrder(to)) return setDated(to);
    status.run(() => setPurchaseStatusAction(projectId, order.id, { status: to }));
  }

  const actions = canManage && order.status !== "cancelled" && (
    <>
      {registerHref && (
        <Link href={registerHref} className={buttonVariants({ variant: next ? "outline" : "default" })}>
          {t("registerInvoice")}
        </Link>
      )}
      {next && (
        <Button type="button" onClick={() => advance(next)} disabled={status.pending}>
          {t(`advance.${next}`)}
        </Button>
      )}
      <Link href={editOrderHref(projectId, order.id)} className={buttonVariants({ variant: "outline" })}>
        {t("edit")}
      </Link>
      {canCancel(order.status) && (
        <Button
          type="button"
          variant="ghost-destructive"
          disabled={status.pending}
          onClick={() =>
            status.confirmThen(t("confirmCancel", { number: orderLabel(order.number) }), () =>
              setPurchaseStatusAction(projectId, order.id, { status: "cancelled" }),
            )
          }
        >
          {t("cancelOrder")}
        </Button>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-[18px]">
      <BackLink href={purchasesHref(projectId)} />

      <OrderHeading order={order} actions={actions || undefined} />
      {!dated && <FormError namespace="purchasing.errors" error={status.state?.error} />}

      <LateBanner order={order} issuesHref={obraHref(projectId, "issues")} />

      {dated && (
        <StatusForm
          title={t(`dated.${dated}.title`)}
          hint={t(`dated.${dated}.hint`)}
          dateLabel={t(`dated.${dated}.date`)}
          confirmLabel={t(`dated.${dated}.confirm`)}
          today={order.today}
          pending={status.pending}
          error={status.state?.error}
          onCancel={() => setDated(null)}
          onSubmit={({ date, note }) =>
            status.run(
              () => setPurchaseStatusAction(projectId, order.id, { status: dated, date, note }),
              () => setDated(null),
            )
          }
        />
      )}

      <StatusSteps order={order} />

      <MilestonesCard
        order={order}
        canEdit={canManage && order.status !== "cancelled"}
        pending={schedule.pending}
        error={schedule.state?.error}
        onSave={(milestones, onSaved) => schedule.run(() => setOrderMilestonesAction(order.id, milestones), onSaved)}
      />
      <OrderInvoices order={order} registerHref={registerHref} />

      {/* Full width: the lines table needs ~760px, more than a two-thirds column has on a laptop. */}
      <OrderLines order={order} />

      <div className="grid items-start gap-[18px] lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-[18px]">
          <OrderData
            order={order}
            editHref={canManage && order.status !== "cancelled" ? editOrderHref(projectId, order.id) : undefined}
          />
          <OrderDocuments
            documents={order.documents}
            documentUrl={(documentId, versionId) => orderDocumentUrl(order.id, documentId, versionId)}
            canManage={canManage}
            pending={file.pending}
            error={file.state?.error}
            onAdd={({ title, file: chosen }, done) => {
              const data = new FormData();
              data.set("title", title);
              data.set("file", chosen);
              file.run(() => addOrderDocumentAction(projectId, order.id, data), done);
            }}
            onAddVersion={(documentId, { file: chosen, note }, done) => {
              const data = new FormData();
              data.set("file", chosen);
              if (note) data.set("note", note);
              file.run(() => addOrderDocumentVersionAction(projectId, order.id, documentId, data), done);
            }}
            onDismiss={file.reset}
            onRemove={(document) =>
              file.confirmThen(t("documents.confirmRemove", { title: document.title }), () =>
                deleteOrderDocumentAction(projectId, order.id, document.id),
              )
            }
          />
        </div>
        <div className="min-w-0 lg:col-span-2">
          <OrderHistory events={order.events} />
        </div>
      </div>
    </div>
  );
}
