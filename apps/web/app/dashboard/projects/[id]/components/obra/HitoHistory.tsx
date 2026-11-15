"use client";

// Presentational: a hito's history (Historial), in words. HitoScreen passes
// the events.

import { useTranslations } from "next-intl";
import type {
  HitoEvent,
  HitoFileFacts,
  HitoPaymentFacts,
} from "@repo/core/contract";
import { cardVariants } from "@/components/ui/card";
import { cardHead, muted } from "./classes";
import { useObraFormat } from "./format";

/** One entry of the history in words, with its figures. */
function HitoEventText({ event }: { event: HitoEvent }) {
  const t = useTranslations("obra.hito.history");
  const f = useObraFormat();
  const file = (facts: HitoFileFacts) => ({
    date: f.date(facts.date),
    size: facts.sizeBytes === null ? "—" : f.fileSize(facts.sizeBytes),
  });
  const payment = (facts: HitoPaymentFacts) => ({
    date: f.date(facts.paidOn),
    amount: facts.amountCents === null ? "—" : f.money(facts.amountCents),
  });

  switch (event.action) {
    case "acta_uploaded":
    case "invoice_uploaded": {
      const kind = event.action === "acta_uploaded" ? "acta" : "invoice";
      const { previous } = event.detail;
      if (!previous) return t(`${kind}Uploaded`, file(event.detail));
      const was = file(previous);
      return t(`${kind}Replaced`, { ...file(event.detail), previousDate: was.date, previousSize: was.size });
    }
    case "acta_removed":
      return t("actaRemoved", file(event.detail));
    case "invoice_removed":
      return t("invoiceRemoved", file(event.detail));
    case "payment_registered": {
      const { previous } = event.detail;
      if (!previous) return t("paymentRegistered", payment(event.detail));
      const was = payment(previous);
      return t("paymentCorrected", { ...payment(event.detail), previousDate: was.date, previousAmount: was.amount });
    }
    case "payment_cancelled":
      return t("paymentCancelled", payment(event.detail));
  }
}

/**
 * Every acta, invoice and payment registered, corrected or cancelled on the
 * hito, newest first, with who did it. Staff only: the client's app has no
 * such history.
 */
export function HitoHistory({ events }: { events: HitoEvent[] }) {
  const t = useTranslations("obra.hito.history");
  const f = useObraFormat();
  return (
    <section className={cardVariants()} aria-labelledby="hito-history-title">
      <div className={cardHead}>
        <h2 id="hito-history-title">{t("title")}</h2>
        <span className={muted}>{t("hint")}</span>
      </div>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("empty")}</p>
      ) : (
        <ul className="m-0 list-none p-0" aria-labelledby="hito-history-title">
          {events.map((event) => (
            <li
              key={event.id}
              className="grid gap-x-4 gap-y-0.5 border-b py-2.5 text-sm last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)]"
            >
              <time dateTime={event.at} className="num text-meta text-muted-foreground">
                {f.dateTime(event.at)}
              </time>
              <div className="min-w-0 [overflow-wrap:anywhere]">
                <HitoEventText event={event} />
                {event.userName && <span className="text-muted-foreground"> · {event.userName}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
