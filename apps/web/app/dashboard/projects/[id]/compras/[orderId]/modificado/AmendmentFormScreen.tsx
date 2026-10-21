"use client";

// Container for recording an order's modificado: the only part of it that
// knows about server actions. The views in ../../../components/purchasing
// take props only.

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { orderLabel, type PurchaseForm, type PurchaseOrderDetail } from "@repo/core/contract";
import { buttonVariants } from "@/components/ui/button";
import { amendPurchaseAction } from "../../../../../../actions/purchasing";
import BackLink from "../../../../../components/BackLink";
import { formWithFile } from "../../../../../compras/components/invoice-draft";
import { StageEyebrow } from "../../../components/construction/ObraFrame";
import { useObraFormat } from "../../../components/obra/format";
import { conceptAndLinesComplete, linesInput, orderDraftFrom } from "../../../components/purchasing/draft";
import { orderHref } from "../../../components/purchasing/links";
import { AmendmentForm, type AmendmentDraft } from "../../../components/purchasing/OrderAmendmentViews";

export default function AmendmentFormScreen({
  projectId,
  form,
  order,
}: {
  projectId: string;
  /** The order form on this order (`editing`): its lines and the contract's. */
  form: PurchaseForm;
  order: PurchaseOrderDetail;
}) {
  const t = useTranslations("purchasing.amendments.form");
  const f = useObraFormat();
  const router = useRouter();
  const number = (order.amendments[0]?.number ?? 0) + 1;
  const [draft, setDraft] = useState<AmendmentDraft>(() => {
    const { chapter, lines } = orderDraftFrom(form.editing!, form, f);
    return { concept: "", signedOn: form.today, chapter, lines, file: null };
  });
  const [error, setError] = useState<string | null>(null);
  const [documentFailed, setDocumentFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const parse = f.hundredths;
  const back = orderHref(projectId, order.id);

  function save() {
    setError(null);
    if (!conceptAndLinesComplete({ description: draft.concept, lines: draft.lines }, parse)) return setError("amendment_incomplete");
    const data = {
      concept: draft.concept.trim(),
      signedOn: draft.signedOn || null,
      // Core puts the number it gives the modificado in place of {n}.
      ...(draft.file ? { documentTitle: t("documentName", { number: "{n}" }) } : {}),
      lines: linesInput(draft, parse),
    };
    startTransition(async () => {
      const state = await amendPurchaseAction(projectId, order.id, formWithFile(data, draft.file));
      if (!state?.success) return setError(state?.error ?? "generic");
      if (state.documentFailed) return setDocumentFailed(true);
      router.push(back);
    });
  }

  return (
    <div className="flex flex-col gap-[18px] pb-4">
      <BackLink href={back} />
      <header className="min-w-0">
        <StageEyebrow label={`${order.projectRef} · ${orderLabel(order.number)}`} />
        <h1 className="mt-1.5">{t("title", { number })}</h1>
        <p className="mt-1 max-w-[680px] text-[14px] text-muted-foreground">{t("intro")}</p>
      </header>
      {documentFailed ? (
        <div role="alert" className="flex flex-col gap-2 rounded-xl bg-warn-soft px-4 py-3 text-[13.5px] text-warn">
          <p className="m-0 font-semibold">{t("documentFailed", { number })}</p>
          <Link className={buttonVariants({ variant: "outline", size: "sm", className: "w-fit" })} href={back}>
            {t("goToOrder")}
          </Link>
        </div>
      ) : (
        <AmendmentForm
          form={form}
          draft={draft}
          parse={parse}
          number={number}
          beforeCents={order.amountCents}
          pending={pending}
          error={error}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          onSave={save}
          cancelHref={back}
        />
      )}
    </div>
  );
}
