"use client";

// Presentational: an order's history (and a purchase request's), in words.

import { useTranslations } from "next-intl";
import {
  isCompletedOrder,
  type PurchaseOrderEvent,
  type PurchaseStatus,
} from "@repo/core/contract";
import { cardVariants } from "@/components/ui/card";
import { day, usePurchaseFormat } from "./format";

const FIELD_DATES = new Set(["orderedOn", "expectedOn", "workStart", "workEnd", "issuedOn", "dueOn", "neededBy"]);

/** One history entry (an order's, or the parts a purchase request shares with it), in words. */
export function EventText({ event }: { event: PurchaseOrderEvent }) {
  const t = useTranslations("purchasing.history");
  const ts = useTranslations("purchasing.status");
  const tk = useTranslations("purchasing.kind");
  const tv = useTranslations("purchasing.vat");
  const f = usePurchaseFormat();
  const d = event.detail;
  const num = (value: unknown) => (typeof value === "number" ? value : 0);
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const shown = (key: string, value: unknown) => {
    if (value === null || value === undefined || value === "") return "—";
    if (FIELD_DATES.has(key)) return f.date(String(value));
    if (key === "kind") return tk(String(value) as "material");
    if (key === "vatKind") return tv(String(value) as "vat21");
    if (key === "retentionBp" || key === "irpfBp") return f.share(Number(value));
    if (key === "baseCents") return f.amount(Number(value));
    return String(value);
  };

  switch (event.action) {
    case "created":
      return <>{t("created", { count: num(d.lines), amount: f.amount(num(d.amountCents)) })}</>;
    case "status": {
      const from = text(d.from);
      const to = text(d.to);
      const label = <b>{`${from ? ts(from as PurchaseStatus) : "—"} → ${to ? ts(to as PurchaseStatus) : "—"}`}</b>;
      const completed = to !== "" && isCompletedOrder(to as PurchaseStatus);
      return (
        <>
          {label}
          {completed && typeof d.date === "string" && t(to === "delivered" ? "deliveredOn" : "finishedOn", { date: f.date(d.date) })}
        </>
      );
    }
    case "updated": {
      const fields = (d.fields ?? {}) as Record<string, { from: unknown; to: unknown }>;
      return (
        <>
          {Object.entries(fields).map(([key, change], index) => (
            <span key={key}>
              {index > 0 && " · "}
              {key === "subcontractorId" || key === "notes"
                ? t(`changed.${key}`)
                : t("field", {
                    field: t.has(`fields.${key}`) ? t(`fields.${key}`) : t("fields.other"),
                    from: shown(key, change.from),
                    to: shown(key, change.to),
                  })}
            </span>
          ))}
        </>
      );
    }
    case "lines": {
      type Shape = { amountCents: number; closesLine: boolean } | null;
      const changes = (Array.isArray(d.changes) ? d.changes : []) as { code: string | null; from: Shape; to: Shape }[];
      return (
        <>
          {changes.map((change, index) => {
            const code = change.code ?? "—";
            let line: string;
            if (!change.from && change.to) line = t("lineAdded", { code, amount: f.amount(change.to.amountCents) });
            else if (change.from && !change.to) line = t("lineRemoved", { code });
            else if (change.from && change.to && change.from.amountCents !== change.to.amountCents)
              line = t("lineAmount", { code, from: f.amount(change.from.amountCents), to: f.amount(change.to.amountCents) });
            else line = t(change.to?.closesLine ? "lineCloses" : "lineReopens", { code });
            return (
              <span key={`${code}-${index}`}>
                {index > 0 && " · "}
                {line}
              </span>
            );
          })}
          {/* An edit that moved the amount took the payment schedule with it. */}
          {typeof d.scheduleDeltaCents === "number" && d.scheduleDeltaCents !== 0 && (
            <span>
              {changes.length > 0 && " · "}
              {t(d.scheduleDeltaCents > 0 ? "scheduleRaised" : "scheduleCut", { amount: f.amount(Math.abs(d.scheduleDeltaCents)) })}
            </span>
          )}
        </>
      );
    }
    case "amended":
      return (
        <>
          {t("amended", { number: num(d.number), amount: f.signedAmount(num(d.deltaCents)) })}
          {typeof d.concept === "string" && <span className="text-muted-foreground"> “{d.concept}”</span>}
        </>
      );
    case "invoice_created":
      return <>{t(d.kind === "credit_note" ? "creditCreated" : "invoiceCreated", { number: text(d.number), amount: f.amount(num(d.baseCents)) })}</>;
    case "invoice_updated": {
      const fields = (d.fields ?? {}) as Record<string, { from: unknown; to: unknown }>;
      return (
        <>
          {t("invoiceUpdated", { number: text(d.number) })}
          {Object.entries(fields)
            .filter(([key]) => key !== "notes" && key !== "milestoneId")
            .map(([key, change]) => (
              <span key={key}>
                {" · "}
                {t("field", { field: t.has(`fields.${key}`) ? t(`fields.${key}`) : t("fields.other"), from: shown(key, change.from), to: shown(key, change.to) })}
              </span>
            ))}
        </>
      );
    }
    case "invoice_deleted":
      return <>{t("invoiceDeleted", { number: text(d.number) })}</>;
    case "invoice_restored":
      return <>{t("invoiceRestored", { number: text(d.number) })}</>;
    case "invoice_file_added":
      return <>{t("invoiceFileAdded", { number: text(d.number), version: num(d.version) })}</>;
    case "payment_added":
      return <>{t("paymentAdded", { number: text(d.number), amount: f.amount(num(d.amountCents)) })}</>;
    case "payment_deleted":
      return <>{t("paymentDeleted", { number: text(d.number), amount: f.amount(num(d.amountCents)) })}</>;
    case "payment_restored":
      return <>{t("paymentRestored", { number: text(d.number), amount: f.amount(num(d.amountCents)) })}</>;
    case "milestones":
      return <>{t("milestones", { count: Array.isArray(d.to) ? d.to.length : 0 })}</>;
    case "document_added":
      return <>{t("documentAdded", { title: text(d.title) })}</>;
    case "document_version_added":
      return <>{t("documentVersionAdded", { title: text(d.title), version: num(d.version) })}</>;
    case "document_removed":
      return <>{t("documentRemoved", { title: text(d.title) })}</>;
    case "document_restored":
      return <>{t("documentRestored", { title: text(d.title) })}</>;
    case "file_added":
      return <>{t("fileAdded", { name: text(d.name) })}</>;
    case "file_removed":
      return <>{t("fileRemoved", { name: text(d.name) })}</>;
    default:
      // An action this build doesn't know (written by a newer one): never its code.
      return <>{t("other")}</>;
  }
}

/** Every change to the order (or to a request, with its own `Text`), newest first. */
export function OrderHistory({
  events,
  Text = EventText,
}: {
  events: PurchaseOrderEvent[];
  Text?: (props: { event: PurchaseOrderEvent }) => React.ReactNode;
}) {
  const t = useTranslations("purchasing.history");
  const f = usePurchaseFormat();
  return (
    <section className={cardVariants()} aria-labelledby="history-title">
      <h2 id="history-title" className="text-[22px]">
        {t("title")}
      </h2>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="m-0 list-none p-0">
          {events.map((event) => (
            <li key={event.id} className="grid gap-x-4 gap-y-0.5 border-b py-2.5 text-sm last:border-b-0 sm:grid-cols-[110px_minmax(0,1fr)]">
              <span className="num text-meta text-muted-foreground">{f.date(day(event.at))}</span>
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <Text event={event} />
                {event.note && <span className="text-muted-foreground"> “{event.note}”</span>}
                {event.by && <span className="text-muted-foreground"> · {event.by}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
