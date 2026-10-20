"use client";

// Container for a purchase request's page: the only part of it that knows
// about server actions (decide, cancel). The views in
// ../../../components/purchasing take props only.

import Link from "next/link";
import { useTranslations } from "next-intl";
import { isOpenRequest, requestLabel, type PurchaseRequestDetail } from "@repo/core/contract";
import { Button, buttonVariants } from "@/components/ui/button";
import { cancelRequestAction, decideRequestAction } from "../../../../../../actions/purchase-requests";
import BackLink from "../../../../../components/BackLink";
import FormError from "../../../../../components/FormError";
import { useObraAction } from "../../../components/obra/useObraAction";
import { editRequestHref, orderFromRequestHref, orderHref, requestsViewHref } from "../../../components/purchasing/links";
import { OrderHistory } from "../../../components/purchasing/OrderViews";
import {
  DecisionCard,
  RequestData,
  RequestEventText,
  RequestHeading,
  RequestLateBanner,
  RequestLines,
} from "../../../components/purchasing/RequestViews";

export default function RequestScreen({
  projectId,
  request,
  canManage,
  canDecide,
}: {
  projectId: string;
  request: PurchaseRequestDetail;
  canManage: boolean;
  /** Admins approve or reject. */
  canDecide: boolean;
}) {
  const t = useTranslations("purchasing.requests.detail");
  const decision = useObraAction();
  const cancel = useObraAction();
  const newOrderHref = canManage && request.status === "approved" ? orderFromRequestHref(projectId, request.id) : undefined;

  const actions = canManage && (
    <>
      {newOrderHref && (
        <Link href={newOrderHref} className={buttonVariants()}>
          {t("createOrder")}
        </Link>
      )}
      {request.status === "pending" && (
        <Link href={editRequestHref(projectId, request.id)} className={buttonVariants({ variant: "outline" })}>
          {t("edit")}
        </Link>
      )}
      {isOpenRequest(request.status) && (
        <Button
          type="button"
          variant="ghost-destructive"
          disabled={cancel.pending}
          onClick={() =>
            cancel.confirmThen(t("confirmCancel", { number: requestLabel(request.number) }), () => cancelRequestAction(request.id))
          }
        >
          {t("cancel")}
        </Button>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-[18px]">
      <BackLink href={requestsViewHref(projectId)} />
      <RequestHeading request={request} actions={actions || undefined} />
      <FormError namespace="purchasing.requestErrors" error={cancel.state?.error} />
      <RequestLateBanner request={request} />

      <DecisionCard
        request={request}
        canDecide={canDecide}
        orderHref={request.order ? orderHref(projectId, request.order.id) : undefined}
        pending={decision.pending}
        error={decision.state?.error}
        onDecide={(choice, note) => decision.run(() => decideRequestAction(request.id, { decision: choice, note }))}
      />

      <RequestLines request={request} />

      <div className="grid items-start gap-[18px] lg:grid-cols-3">
        <div className="min-w-0">
          <RequestData request={request} />
        </div>
        <div className="min-w-0 lg:col-span-2">
          <OrderHistory events={request.events} Text={RequestEventText} />
        </div>
      </div>
    </div>
  );
}
