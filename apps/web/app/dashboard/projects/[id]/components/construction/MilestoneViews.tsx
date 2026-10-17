"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { MILESTONE_STATES, type ChapterState, type ControlMilestone } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { totalRow } from "./classes";
import { useControlFormat } from "./format";
import { MILESTONE_TONE, MilestoneStatePill } from "./pills";
import { Dash } from "./SummaryTable";

// Presentational: Obra › Hitos, the payment milestones as the works reach them.

const STATE_DOT: Record<ChapterState, string> = {
  finished: "bg-good",
  in_progress: "bg-primary",
  pending: "border border-muted-foreground/60 bg-card",
};

const ChapterDot = ({ state }: { state: ChapterState }) => (
  <span aria-hidden className={cn("inline-block size-2 flex-none rounded-full", STATE_DOT[state])} />
);

/** The five states a hito goes through, in order. */
export function MilestoneSteps() {
  const t = useTranslations("construction.milestones");
  const ts = useTranslations("construction.milestoneState");
  return (
    <ol aria-label={t("stepsLabel")} className="m-0 grid list-none grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))] gap-2.5 p-0">
      {MILESTONE_STATES.map((state) => (
        <li key={state} className="flex flex-col items-start gap-1.5 rounded-xl border bg-card px-3.5 py-3 text-[12.5px]">
          <Badge variant={MILESTONE_TONE[state]}>{ts(state)}</Badge>
          <span className="text-muted-foreground">{t(`steps.${state}`)}</span>
        </li>
      ))}
    </ol>
  );
}

/** Every hito: its chapters, agreed amount, state, and what was invoiced and collected. */
export function MilestoneTable({
  milestones,
  invoiceHref,
}: {
  milestones: ControlMilestone[];
  /** The hito on the Pagos tab, where its invoice is. */
  invoiceHref: (milestone: ControlMilestone) => string;
}) {
  const t = useTranslations("construction.milestones");
  const tc = useTranslations("construction.chapterState");
  const f = useControlFormat();
  const sum = (pick: (m: ControlMilestone) => number) => milestones.reduce((total, m) => total + pick(m), 0);
  const amount = (cents: number) => (cents ? <span className="num">{f.decimal(cents / 100)}</span> : <Dash />);

  return (
    <section className={cn(cardVariants({ size: "flush" }), "py-1.5")} aria-label={t("tableLabel")}>
      <Table className="min-w-[980px] text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead className="pl-[18px]">{t("hito")}</TableHead>
            <TableHead>{t("chapters")}</TableHead>
            <TableHead className="text-right">%</TableHead>
            <TableHead className="text-right">{t("agreed")}</TableHead>
            <TableHead>{t("state")}</TableHead>
            <TableHead className="text-right">{t("invoiced")}</TableHead>
            <TableHead className="text-right">{t("collected")}</TableHead>
            <TableHead className="text-right">{t("outstanding")}</TableHead>
            <TableHead className="pr-[18px]">{t("invoice")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {milestones.map((m) => {
            const missing = m.chapters.filter((c) => c.state !== "finished");
            return (
              <TableRow key={m.id}>
                <TableCell className="pl-[18px] whitespace-normal">
                  <span className="num font-semibold">{m.code}</span> {m.name}
                  {m.state === "pending" && missing.length > 0 && missing.length < m.chapters.length && (
                    <div className="text-[12px] text-muted-foreground">
                      {t("missing", {
                        chapters: missing.map((c) => `${c.code} · ${tc(c.state).toLowerCase()}`).join(", "),
                      })}
                    </div>
                  )}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {m.chapters.length === 0 ? (
                    <Dash />
                  ) : (
                    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
                      {m.chapters.map((c) => (
                        <li
                          key={c.code}
                          title={`${c.code} · ${c.name} · ${tc(c.state)}`}
                          className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 font-mono text-[11.5px] font-semibold"
                        >
                          <ChapterDot state={c.state} />
                          {c.code}
                          <span className="sr-only">{tc(c.state)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
                <TableCell className="num text-right">{f.quantity(m.pctBp / 100)}</TableCell>
                <TableCell className="num text-right">{f.decimal(m.amountCents / 100)}</TableCell>
                <TableCell>
                  <MilestoneStatePill state={m.state} />
                </TableCell>
                <TableCell className="text-right">{amount(m.invoicedCents)}</TableCell>
                <TableCell className="text-right">{amount(m.collectedCents)}</TableCell>
                <TableCell className={cn("text-right", m.outstandingCents > 0 && "text-warn")}>
                  {m.invoicedCents ? <span className="num">{f.decimal(m.outstandingCents / 100)}</span> : <Dash />}
                </TableCell>
                <TableCell className="pr-[18px]">
                  {m.hasInvoice ? (
                    <Link href={invoiceHref(m)} className="font-semibold text-brand-ink hover:text-primary">
                      {t("seeInvoice")}
                      {m.invoicedOn && <span className="num ml-1.5 font-normal text-muted-foreground">{f.day(m.invoicedOn)}</span>}
                    </Link>
                  ) : (
                    <Dash />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
          <TableRow className={totalRow}>
            <TableCell className="pl-[18px]">{t("total")}</TableCell>
            <TableCell />
            <TableCell className="num text-right">{f.quantity(sum((m) => m.pctBp) / 100)}</TableCell>
            <TableCell className="num text-right">{f.decimal(sum((m) => m.amountCents) / 100)}</TableCell>
            <TableCell />
            <TableCell className="num text-right">{f.decimal(sum((m) => m.invoicedCents) / 100)}</TableCell>
            <TableCell className="num text-right text-good">{f.decimal(sum((m) => m.collectedCents) / 100)}</TableCell>
            <TableCell className="num text-right text-warn">{f.decimal(sum((m) => m.outstandingCents) / 100)}</TableCell>
            <TableCell className="pr-[18px]" />
          </TableRow>
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-[18px] pt-2.5 pb-3 text-[12px] text-muted-foreground">
        {(["finished", "in_progress", "pending"] as const).map((state) => (
          <span key={state} className="inline-flex items-center gap-1.5">
            <ChapterDot state={state} />
            {tc(state)}
          </span>
        ))}
        <span>{t("legendNote")}</span>
      </div>
    </section>
  );
}

/** What finishing a hito's last chapter asked of Administration, newest first. */
export function InvoiceRequests({ milestones }: { milestones: ControlMilestone[] }) {
  const t = useTranslations("construction.milestones");
  const f = useControlFormat();
  const requests = milestones
    .filter((m) => m.request)
    .sort((a, b) => b.request!.requestedAt.localeCompare(a.request!.requestedAt));

  function status(m: ControlMilestone) {
    if (m.state === "collected") return <Badge variant="good">{m.paidOn ? t("collectedOn", { date: f.day(m.paidOn) }) : t("collectedShort")}</Badge>;
    if (m.state === "invoiced") return <Badge variant="info">{m.invoicedOn ? t("invoicedOn", { date: f.day(m.invoicedOn) }) : t("invoicedShort")}</Badge>;
    return <Badge variant="yel">{t("toInvoice")}</Badge>;
  }

  return (
    <section className={cn(cardVariants({ size: "flush" }), "pt-[18px] pb-1.5")} aria-labelledby="requests-title">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-[18px] pb-3">
        <h2 id="requests-title">{t("requestsTitle")}</h2>
        <span className="text-[12.5px] text-muted-foreground">{t("requestsHint")}</span>
      </div>
      {requests.length === 0 ? (
        <p className="px-[18px] pb-4 text-[13px] text-muted-foreground">{t("noRequests")}</p>
      ) : (
        <Table className="min-w-[760px] text-[13px]" aria-labelledby="requests-title">
          <TableHeader>
            <TableRow>
              <TableHead className="pl-[18px]">{t("hito")}</TableHead>
              <TableHead>{t("concept")}</TableHead>
              <TableHead className="text-right">{t("amount")}</TableHead>
              <TableHead>{t("created")}</TableHead>
              <TableHead className="pr-[18px]">{t("state")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {requests.map((m) => {
              const request = m.request!;
              return (
                <TableRow key={request.id}>
                  <TableCell className="num pl-[18px] font-semibold">{request.hitoCode}</TableCell>
                  <TableCell className="whitespace-normal">
                    {request.description}
                    {request.clientName && <span className="text-muted-foreground"> · {request.clientName}</span>}
                  </TableCell>
                  <TableCell className="num text-right">{f.decimal(request.amountCents / 100)}</TableCell>
                  <TableCell className="whitespace-normal">
                    <span className="num">{f.stampDay(request.requestedAt)}</span>{" "}
                    <span className="text-muted-foreground">
                      {t("createdBy", { code: request.chapterCode, name: request.requestedBy ?? "—" })}
                    </span>
                  </TableCell>
                  <TableCell className="pr-[18px]">{status(m)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
