"use client";

import { useTranslations } from "next-intl";
import { type PurchaseInvoiceForm } from "@repo/core/contract";
import FileSlot from "../../subcontratas/empresas/nueva/steps/FileSlot";
import { usePurchaseFormat } from "../../projects/[id]/components/purchasing/format";
import { type InvoiceDraft, type Parse } from "./invoice-draft";
import { Amounts, Heading, Milestone, OrderAndNumber, section, Split, Summary } from "./InvoiceSteps";

// Presentational: the supplier invoice (or credit note) form, new or edited.
// The container (InvoiceFormScreen) holds the draft and saves it.

/** Presentational: the invoice form; steps numbered by what the order needs. */
export default function InvoiceForm({
  form,
  draft,
  parse,
  onChange,
  supplierId,
  onSupplier,
  onOrder,
  editing,
  locked,
  pending,
  error,
  canSave,
  onSave,
  cancelHref,
}: {
  form: PurchaseInvoiceForm;
  draft: InvoiceDraft;
  parse: Parse;
  onChange: (patch: Partial<InvoiceDraft>) => void;
  supplierId: string;
  onSupplier: (id: string) => void;
  onOrder: (id: string) => void;
  /** Editing an invoice: its kind, order and credit note's invoice stay. */
  editing: boolean;
  /** It has payments: only its number, dates and notes can change. */
  locked: boolean;
  pending: boolean;
  error: string | null;
  canSave: boolean;
  onSave: () => void;
  cancelHref: string;
}) {
  const t = useTranslations("purchasing.invoiceForm");
  const f = usePurchaseFormat();
  const order = form.order;
  const credit = draft.kind === "credit_note";
  const withMilestone = !!order && !credit && order.milestones.length > 0;
  const withSplit = !!order && !credit && order.lines.length > 1;
  let step = 1;
  const next = () => ++step;
  const rectified = order?.invoices.find((i) => i.id === draft.rectifiesId) ?? null;
  return (
    <form
      noValidate
      aria-label={t("label")}
      className="flex flex-wrap items-start gap-[18px]"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-[18px]">
        <OrderAndNumber
          form={form}
          draft={draft}
          onChange={onChange}
          supplierId={supplierId}
          onSupplier={onSupplier}
          onOrder={onOrder}
          editing={editing}
        />
        {locked && (
          <p role="status" className="m-0 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn">
            {t("paidLocked")}
          </p>
        )}
        {order && (
          <>
            {withMilestone && (
              <Milestone
                order={order}
                draft={draft}
                step={next()}
                locked={locked}
                // A new invoice's base starts at what is left of the milestone.
                onPick={(milestoneId, left) => onChange({ milestoneId, ...(left > 0 && !editing ? { base: f.decimal(left / 100) } : {}) })}
              />
            )}
            <Amounts order={order} draft={draft} step={next()} locked={locked} onChange={onChange} />
            {withSplit && <Split order={order} draft={draft} step={next()} parse={parse} locked={locked} onChange={onChange} />}
            {!editing && (
              <section className={section} aria-labelledby="invoice-document">
                <Heading id="invoice-document" hint={t("documentHint")}>
                  {t("documentTitle", { n: next() })}{" "}
                  <span className="font-sans text-sm font-normal tracking-normal text-muted-foreground">{t("optional")}</span>
                </Heading>
                <FileSlot
                  id="invoice-file"
                  label={t("chooseFile")}
                  file={draft.file}
                  onChange={(file) => onChange({ file })}
                  namespace="purchasing.invoiceForm"
                  errorNamespace="purchasing.errors"
                />
              </section>
            )}
          </>
        )}
      </div>
      {order && (
        <div className="min-w-0 flex-[1_1_320px] self-stretch">
          <Summary
            order={order}
            draft={draft}
            parse={parse}
            previousBaseCents={editing ? (form.editing?.baseCents ?? 0) : 0}
            rectifiedNumber={rectified?.number ?? null}
            pending={pending}
            error={error}
            saveLabel={editing ? t("saveChanges") : credit ? t("saveCredit") : t("save")}
            cancelHref={cancelHref}
            canSave={canSave}
          />
        </div>
      )}
    </form>
  );
}
