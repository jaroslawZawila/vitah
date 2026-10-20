"use client";

// Container for the supplier invoice form, new (facturas/nueva, `?pedido=`
// and `?abono=` for a credit note) or edited (facturas/[invoiceId]/editar):
// the only part of it that knows about server actions. Picking another order
// reloads the page on it. The views in ../components take props only.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PurchaseInvoiceForm } from "@repo/core/contract";
import { createInvoiceAction, updateInvoiceAction } from "../../../actions/purchase-invoices";
import BackLink from "../../components/BackLink";
import { useObraFormat } from "../../projects/[id]/components/obra/format";
import { INVOICES_HREF, invoiceHref, newInvoiceHref } from "../../projects/[id]/components/purchasing/links";
import InvoiceForm from "../components/InvoiceForm";
import {
  formWithFile,
  invoiceComplete,
  invoiceDraftFrom,
  invoiceInput,
  newInvoiceDraft,
  type InvoiceDraft,
} from "../components/invoice-draft";

export default function InvoiceFormScreen({ form, rectifiesId }: { form: PurchaseInvoiceForm; rectifiesId?: string }) {
  const t = useTranslations("purchasing.invoiceForm");
  const ti = useTranslations("purchasing.invoices");
  const f = useObraFormat();
  const router = useRouter();
  const { order, editing } = form;
  const chosen = order ? form.orders.find((o) => o.id === order.id) : undefined;
  const [supplierId, setSupplierId] = useState(editing?.subcontractorId ?? chosen?.subcontractorId ?? "");
  const [draft, setDraft] = useState<InvoiceDraft>(() =>
    editing ? invoiceDraftFrom(editing, order, f) : newInvoiceDraft(form, f, rectifiesId),
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const parse = f.hundredths;
  // Paid against already: its amounts stay as they are.
  const locked = !!editing && editing.payments.length > 0;
  const credit = draft.kind === "credit_note";

  function change(patch: Partial<InvoiceDraft>) {
    setError(null);
    setDraft((current) => {
      if (patch.kind && patch.kind !== current.kind) {
        // Another kind starts over, keeping what was typed about the document itself.
        return patch.kind === "credit_note"
          ? { ...current, kind: patch.kind, milestoneId: "", rectifiesId: "", base: "", lines: null }
          : { ...newInvoiceDraft(form, f), number: current.number, issuedOn: current.issuedOn, notes: current.notes, file: current.file };
      }
      const next = { ...current, ...patch };
      if (!patch.rectifiesId) return next;
      // A credit note takes its rates from the invoice it rectifies.
      const { vatKind, retention, irpf } = newInvoiceDraft(form, f, patch.rectifiesId);
      return { ...next, vatKind, retention, irpf };
    });
  }

  function save() {
    setError(null);
    if (!order) return;
    if (!invoiceComplete(draft, order, parse)) return setError("missing_fields");
    startTransition(async () => {
      if (editing) {
        const state = await updateInvoiceAction(editing.id, invoiceInput(draft, order, parse, { locked }));
        if (!state?.success) return setError(state?.error ?? "generic");
        return router.push(invoiceHref(editing.id));
      }
      const state = await createInvoiceAction(order.id, formWithFile(invoiceInput(draft, order, parse), draft.file));
      if (!state?.success || !state.invoiceId) return setError(state?.error ?? "generic");
      router.push(invoiceHref(state.invoiceId));
    });
  }

  const title = editing ? (credit ? t("editCreditTitle") : t("editTitle")) : credit ? t("newCreditTitle") : t("newTitle");
  return (
    <div className="flex flex-col gap-[18px] pb-4">
      <BackLink href={editing ? invoiceHref(editing.id) : INVOICES_HREF} />
      <header className="min-w-0">
        <span className="eyebrow">{ti("eyebrow")}</span>
        <h1 className="mt-1.5">{title}</h1>
        <p className="mt-1 max-w-[680px] text-[14px] text-muted-foreground">{t("intro")}</p>
      </header>
      <InvoiceForm
        form={form}
        draft={draft}
        parse={parse}
        onChange={change}
        supplierId={supplierId}
        onSupplier={(id) => {
          setSupplierId(id);
          // The order picked belongs to another supplier: start again without it.
          if (order && chosen?.subcontractorId !== id) router.replace(newInvoiceHref());
        }}
        onOrder={(id) => router.replace(newInvoiceHref({ orderId: id || undefined }))}
        editing={!!editing}
        locked={locked}
        pending={pending}
        error={error}
        canSave={!!order && invoiceComplete(draft, order, parse)}
        onSave={save}
        cancelHref={editing ? invoiceHref(editing.id) : INVOICES_HREF}
      />
    </div>
  );
}
