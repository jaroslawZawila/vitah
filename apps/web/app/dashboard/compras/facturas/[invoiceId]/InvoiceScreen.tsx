"use client";

// Container for a supplier invoice's page: the only part of it that knows
// about server actions (pay, take a payment back, a new PDF version, delete).
// The views in ../../components take props only.

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import type { PurchaseInvoiceDetail } from "@repo/core/contract";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  addInvoiceFileAction,
  createPaymentAction,
  deleteInvoiceAction,
  deletePaymentAction,
} from "../../../../actions/purchase-invoices";
import BackLink from "../../../components/BackLink";
import FormError from "../../../components/FormError";
import { useObraAction } from "../../../projects/[id]/components/obra/useObraAction";
import { usePurchaseFormat } from "../../../projects/[id]/components/purchasing/format";
import { INVOICES_HREF, editInvoiceHref, newInvoiceHref } from "../../../projects/[id]/components/purchasing/links";
import { OrderHistory } from "../../../projects/[id]/components/purchasing/OrderViews";
import {
  AmountsCard,
  CreditNotes,
  InvoiceBanner,
  InvoiceData,
  InvoiceFiles,
  InvoiceHeading,
  PaymentForm,
  type PaymentValues,
} from "../../components/InvoiceDetailViews";
import { PaymentTable } from "../../components/InvoiceListViews";
import { formWithFile } from "../../components/invoice-draft";

export default function InvoiceScreen({ invoice, canManage }: { invoice: PurchaseInvoiceDetail; canManage: boolean }) {
  const t = useTranslations("purchasing.invoice");
  const f = usePurchaseFormat();
  const router = useRouter();
  const action = useObraAction();
  const payment = useObraAction();
  const file = useObraAction();
  const [paying, setPaying] = useState(false);
  const isInvoice = invoice.kind === "invoice";
  const canPay = canManage && isInvoice && invoice.payableLeftCents > 0;

  function pay(values: PaymentValues) {
    const { file: proof, ...data } = values;
    payment.run(
      () => createPaymentAction(invoice.id, formWithFile({ ...data, reference: data.reference.trim() || null }, proof)),
      () => setPaying(false),
    );
  }

  const actions = canManage && (
    <>
      {canPay && !paying && (
        <Button type="button" onClick={() => setPaying(true)}>
          {t("pay")}
        </Button>
      )}
      {isInvoice && (
        <Link href={newInvoiceHref({ orderId: invoice.orderId, rectifiesId: invoice.id })} className={buttonVariants({ variant: "outline" })}>
          {t("credit")}
        </Link>
      )}
      <Link href={editInvoiceHref(invoice.id)} className={buttonVariants({ variant: "outline" })}>
        {t("edit")}
      </Link>
      <Button
        type="button"
        variant="ghost-destructive"
        disabled={action.pending}
        onClick={() =>
          action.confirmThen(t("confirmDelete", { number: invoice.number }), () => deleteInvoiceAction(invoice.id), () =>
            router.push(INVOICES_HREF),
          )
        }
      >
        {t("delete")}
      </Button>
    </>
  );

  return (
    <div className="flex flex-col gap-[18px]">
      <BackLink href={INVOICES_HREF} />
      <InvoiceHeading invoice={invoice} actions={actions || undefined} />
      <FormError namespace="purchasing.errors" error={action.state?.error} />
      <InvoiceBanner invoice={invoice} />

      {paying && (
        <PaymentForm
          invoice={invoice}
          pending={payment.pending}
          error={payment.state?.error}
          onSubmit={pay}
          onCancel={() => {
            payment.reset();
            setPaying(false);
          }}
        />
      )}

      <div className="grid items-start gap-[18px] lg:grid-cols-2">
        <AmountsCard invoice={invoice} />
        <InvoiceData invoice={invoice} />
      </div>

      {isInvoice && (
        <PaymentTable
          payments={invoice.payments}
          title={
            <>
              {t("payments.title")} <span className="num text-[16px] text-muted-foreground">{invoice.payments.length}</span>
            </>
          }
          empty={t("payments.none")}
          invoiceColumns={false}
          pending={payment.pending}
          onRemove={
            canManage
              ? (removed) =>
                  payment.confirmThen(t("payments.confirmRemove", { amount: f.money(removed.amountCents) }), () =>
                    deletePaymentAction(removed.id),
                  )
              : undefined
          }
        />
      )}
      {!paying && <FormError namespace="purchasing.errors" error={payment.state?.error} />}

      <div className="grid items-start gap-[18px] lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-[18px]">
          <InvoiceFiles
            invoice={invoice}
            canUpload={canManage}
            pending={file.pending}
            error={file.state?.error}
            onUpload={(chosen, note, done) => {
              const data = new FormData();
              data.set("file", chosen);
              if (note.trim()) data.set("note", note.trim());
              file.run(() => addInvoiceFileAction(invoice.id, data), done);
            }}
          />
          <CreditNotes invoice={invoice} />
        </div>
        <OrderHistory events={invoice.events} />
      </div>
    </div>
  );
}
