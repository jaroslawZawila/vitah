"use client";

// Container for the purchase request form, new (compras/solicitudes/nueva)
// or edited while pending (compras/solicitudes/[requestId]/editar): the only
// part of it that knows about server actions. The views in
// ../components/purchasing take props only.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { requestLabel, type PurchaseForm, type PurchaseRequestDetail } from "@repo/core/contract";
import { createRequestAction, updateRequestAction } from "../../../../actions/purchase-requests";
import BackLink from "../../../components/BackLink";
import { StageEyebrow } from "../components/construction/ObraFrame";
import { useObraFormat } from "../components/obra/format";
import { requestHref, requestsViewHref } from "../components/purchasing/links";
import RequestForm from "../components/purchasing/RequestForm";
import { newRequestDraft, requestComplete, requestDraftFrom, requestInput, type RequestDraft } from "../components/purchasing/request-draft";

export default function RequestFormScreen({
  projectId,
  form,
  request,
}: {
  projectId: string;
  /** What it picks from: the order form's suppliers and contract lines. */
  form: PurchaseForm;
  /** The request being edited. */
  request?: PurchaseRequestDetail;
}) {
  const t = useTranslations("purchasing.requests.form");
  const f = useObraFormat();
  const router = useRouter();
  const [draft, setDraft] = useState<RequestDraft>(() => (request ? requestDraftFrom(request, form, f) : newRequestDraft(form)));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const parse = f.hundredths;
  const back = request ? requestHref(projectId, request.id) : requestsViewHref(projectId);

  function save() {
    setError(null);
    if (!requestComplete(draft, parse)) return setError("missing_fields");
    startTransition(async () => {
      if (request) {
        const state = await updateRequestAction(request.id, requestInput(draft, parse));
        if (!state?.success) return setError(state?.error ?? "generic");
        return router.push(requestHref(projectId, request.id));
      }
      const state = await createRequestAction(projectId, requestInput(draft, parse));
      if (!state?.success || !state.requestId) return setError(state?.error ?? "generic");
      router.push(requestHref(projectId, state.requestId));
    });
  }

  return (
    <div className="flex flex-col gap-[18px] pb-4">
      <BackLink href={back} />
      <header className="min-w-0">
        <StageEyebrow label={request ? `${form.ref} · ${requestLabel(request.number)}` : form.ref} />
        <h1 className="mt-1.5">{request ? t("editTitle") : t("newTitle")}</h1>
        <p className="mt-1 max-w-[640px] text-[14px] text-muted-foreground">{t("intro")}</p>
      </header>
      {form.chapters.length === 0 ? (
        <p className="rounded-xl border bg-card px-4 py-6 text-center text-[13.5px] text-muted-foreground">{t("noBudget")}</p>
      ) : (
        <RequestForm
          form={form}
          draft={draft}
          parse={parse}
          onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
          editing={!!request}
          pending={pending}
          error={error}
          onSave={save}
          cancelHref={back}
        />
      )}
    </div>
  );
}
