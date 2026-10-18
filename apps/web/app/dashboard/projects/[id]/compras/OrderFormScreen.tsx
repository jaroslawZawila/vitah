"use client";

// Container for the order form, new (compras/nuevo) or edited
// (compras/[orderId]/editar): the only part of it that knows about server
// actions. A new order's PDF goes up in a request of its own once the order
// exists. The views in ../components/purchasing take props only.

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { orderLabel, placedStatus, type PurchaseForm } from "@repo/core/contract";
import { buttonVariants } from "@/components/ui/button";
import { createPurchaseAction, updatePurchaseAction, uploadPurchaseFileAction } from "../../../../actions/purchasing";
import FormError from "../../../components/FormError";
import { StageEyebrow } from "../components/construction/ObraFrame";
import { useObraFormat } from "../components/obra/format";
import { newOrderDraft, orderComplete, orderDraftFrom, orderInput, type OrderDraft } from "../components/purchasing/draft";
import { orderHref, purchasesHref } from "../components/purchasing/links";
import OrderForm from "../components/purchasing/OrderForm";
import BackLink from "../../../components/BackLink";

export default function OrderFormScreen({
  projectId,
  form,
  chapter,
}: {
  projectId: string;
  /** With `editing` set, the form edits that order. */
  form: PurchaseForm;
  /** A new order's chapter to start on (`?capitulo=`). */
  chapter?: string;
}) {
  const t = useTranslations("purchasing.form");
  const f = useObraFormat();
  const router = useRouter();
  const order = form.editing;
  const [draft, setDraft] = useState<OrderDraft>(() =>
    order ? orderDraftFrom(order, form, f.decimal) : newOrderDraft(form, chapter),
  );
  const [error, setError] = useState<string | null>(null);
  // Set once a new order exists; `error` when its PDF didn't go up (saving again only retries the upload).
  const [created, setCreated] = useState<{ id: string; number: number; error?: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const parse = f.hundredths;

  function save(placed: boolean) {
    setError(null);
    if (!orderComplete(draft, parse)) return setError("missing_fields");
    startTransition(async () => {
      if (order) {
        const state = await updatePurchaseAction(projectId, order.id, orderInput(draft, parse, order.status !== "pending"));
        if (!state?.success) return setError(state?.error ?? "generic");
        return router.push(orderHref(projectId, order.id));
      }
      let made = created;
      if (!made) {
        const status = placed ? placedStatus(draft.kind) : "pending";
        const state = await createPurchaseAction(projectId, { ...orderInput(draft, parse, placed), status });
        if (!state?.success || !state.orderId) return setError(state?.error ?? "generic");
        made = { id: state.orderId, number: state.number ?? form.nextNumber };
      }
      if (draft.file) {
        const data = new FormData();
        data.set("file", draft.file);
        const upload = await uploadPurchaseFileAction(projectId, made.id, null, data);
        if (!upload?.success) return setCreated({ ...made, error: upload?.error ?? "generic" });
      }
      router.push(orderHref(projectId, made.id));
    });
  }

  return (
    <div className="flex flex-col gap-[18px] pb-4">
      <BackLink href={order ? orderHref(projectId, order.id) : purchasesHref(projectId)} />
      <header className="min-w-0">
        <StageEyebrow
          label={
            order
              ? `${form.ref} · ${orderLabel(order.number)}`
              : t("numbered", { ref: form.ref, number: orderLabel(form.nextNumber) })
          }
        />
        <h1 className="mt-1.5">{order ? t("editTitle") : t("newTitle")}</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">{t("intro")}</p>
      </header>

      {created?.error && (
        <div role="alert" className="flex flex-col gap-2 rounded-xl bg-warn-soft px-4 py-3 text-[13.5px] text-warn">
          <p className="m-0 font-semibold">{t("uploadFailed", { number: orderLabel(created.number) })}</p>
          <FormError namespace="purchasing.errors" error={created.error} />
          <Link className={buttonVariants({ variant: "outline", size: "sm", className: "w-fit" })} href={orderHref(projectId, created.id)}>
            {t("goToOrder")}
          </Link>
        </div>
      )}

      {form.chapters.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-6 text-center text-[13.5px] text-muted-foreground">{t("noBudget")}</p>
      ) : (
        <OrderForm
          form={form}
          draft={draft}
          parse={parse}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          editing={order ? { pending: order.status === "pending" } : undefined}
          pending={pending}
          error={error}
          onSave={save}
          cancelHref={order ? orderHref(projectId, order.id) : purchasesHref(projectId)}
        />
      )}
    </div>
  );
}
