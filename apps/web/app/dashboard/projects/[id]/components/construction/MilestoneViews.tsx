"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { MILESTONE_STATES, type ChapterState, type ControlMilestone } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { cardVariants } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { useVatLabel } from "../../../../components/vat-basis";
import { moreLink, totalRow } from "./classes";
import { useControlFormat } from "./format";
import { MILESTONE_TONE, MilestoneStatePill } from "./pills";
import { Dash, Figure } from "./SummaryTable";
import { touchLink } from "../../../../components/touch";

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
    // Two a row on a phone, so the hitos come sooner.
    <ol
      aria-label={t("stepsLabel")}
      className="m-0 grid list-none grid-cols-2 gap-2.5 p-0 sm:grid-cols-[repeat(auto-fit,minmax(min(180px,100%),1fr))]"
    >
      {MILESTONE_STATES.map((state) => (
        <li key={state} className="flex min-w-0 flex-col items-start gap-1.5 rounded-xl border bg-card px-3.5 py-3 text-meta max-sm:px-3">
          <Badge variant={MILESTONE_TONE[state]}>{ts(state)}</Badge>
          <span className="text-muted-foreground">{t(`steps.${state}`)}</span>
        </li>
      ))}
    </ol>
  );
}

/** "Falta 06 · en curso": what a pending hito still waits for, once some of its chapters are finished and not all. */
function useMissingNote() {
  const t = useTranslations("construction.milestones");
  const tc = useTranslations("construction.chapterState");
  return (m: ControlMilestone): string | null => {
    const missing = m.chapters.filter((c) => c.state !== "finished");
    if (m.state !== "pending" || missing.length === 0 || missing.length === m.chapters.length) return null;
    return t("missing", { chapters: missing.map((c) => `${c.code} · ${tc(c.state).toLowerCase()}`).join(", ") });
  };
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
  const missingNote = useMissingNote();
  const f = useControlFormat();
  const sum = (pick: (m: ControlMilestone) => number) => milestones.reduce((total, m) => total + pick(m), 0);
  const amount = (cents: number) => (cents ? <span className="num">{f.decimal(cents / 100)}</span> : <Dash />);

  return (
    <>
      <MilestoneCards milestones={milestones} invoiceHref={invoiceHref} sum={sum} />
      <section className={cn(cardVariants({ size: "flush" }), "py-1.5 max-md:hidden")} aria-label={t("tableLabel")}>
        <Table className="min-w-[980px]">
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
              const missing = missingNote(m);
              return (
                <TableRow key={m.id}>
                  <TableCell className="pl-[18px] whitespace-normal">
                    <span className="num font-semibold">{m.code}</span> {m.name}
                    {missing && <div className="text-meta text-muted-foreground">{missing}</div>}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {m.chapters.length === 0 ? (
                      <Dash />
                    ) : (
                      <ChapterChips chapters={m.chapters} />
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
                      <Link href={invoiceHref(m)} className={cn("font-semibold text-brand-ink hover:text-primary", touchLink)}>
                        {t("seeInvoice")}
                        {m.invoicedOn && <span className="num ml-1.5 font-normal text-muted-foreground">{f.date(m.invoicedOn)}</span>}
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
        <ChapterLegend className="px-[18px] pt-2.5 pb-3" />
      </section>
    </>
  );
}

/** What the chapter dots mean, and how the amounts are given. */
function ChapterLegend({ className }: { className?: string }) {
  const t = useTranslations("construction.milestones");
  const tc = useTranslations("construction.chapterState");
  return (
    <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1.5 text-meta text-muted-foreground", className)}>
      {(["finished", "in_progress", "pending"] as const).map((state) => (
        <span key={state} className="inline-flex items-center gap-1.5">
          <ChapterDot state={state} />
          {tc(state)}
        </span>
      ))}
      <span>{t("legendNote")}</span>
    </div>
  );
}

/** A hito's chapters as chips (they wrap), each with its state as a dot. */
function ChapterChips({ chapters }: { chapters: ControlMilestone["chapters"] }) {
  const tc = useTranslations("construction.chapterState");
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0">
      {chapters.map((c) => (
        <li
          key={c.code}
          title={`${c.code} · ${c.name} · ${tc(c.state)}`}
          className="relative inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 font-mono text-xs font-semibold"
        >
          <ChapterDot state={c.state} />
          {c.code}
          <span className="sr-only">{tc(c.state)}</span>
        </li>
      ))}
    </ul>
  );
}

/** Below 768px: a card per hito, its state and amounts labelled, then the plan's total. */
function MilestoneCards({
  milestones,
  invoiceHref,
  sum,
}: {
  milestones: ControlMilestone[];
  invoiceHref: (milestone: ControlMilestone) => string;
  sum: (pick: (m: ControlMilestone) => number) => number;
}) {
  const t = useTranslations("construction.milestones");
  const missingNote = useMissingNote();
  const f = useControlFormat();
  const money = (cents: number) => f.decimal(cents / 100);
  const figure = (label: string, value: string, tone?: string) => (
    <Figure label={label}>
      <span className={cn("num font-semibold", tone)}>{value}</span>
    </Figure>
  );
  return (
    <div className="flex flex-col gap-2.5 md:hidden">
      <ul className="m-0 flex list-none flex-col gap-2.5 p-0" aria-label={t("tableLabel")}>
        {milestones.map((m) => {
          const missing = missingNote(m);
          return (
            <li key={m.id} className={cn(cardVariants(), "gap-2.5")}>
              <div className="flex items-start gap-2.5">
                <span className="num pt-px font-semibold">{m.code}</span>
                <span className="min-w-0 flex-1 leading-snug font-semibold">{m.name}</span>
                <MilestoneStatePill state={m.state} />
              </div>
              {missing && <p className="text-meta text-muted-foreground">{missing}</p>}
              {m.chapters.length > 0 && <ChapterChips chapters={m.chapters} />}
              <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2">
                {figure(`${t("agreed")} · ${f.quantity(m.pctBp / 100)} %`, money(m.amountCents))}
                {m.invoicedCents > 0 && (
                  <>
                    {figure(t("invoiced"), money(m.invoicedCents))}
                    {figure(t("collected"), money(m.collectedCents))}
                    {figure(t("outstanding"), money(m.outstandingCents), m.outstandingCents > 0 ? "text-warn" : undefined)}
                  </>
                )}
              </dl>
              {m.hasInvoice && (
                <Link href={invoiceHref(m)} className={cn(moreLink, "w-fit")}>
                  {t("seeInvoice")}
                  {m.invoicedOn && <span className="num ml-1.5 font-normal text-muted-foreground">{f.date(m.invoicedOn)}</span>}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
      <section className={cn(cardVariants(), "gap-2.5")} aria-label={t("total")}>
        <span className="eyebrow">{t("total")}</span>
        <dl className="m-0 grid grid-cols-2 gap-x-3 gap-y-2">
          {figure(`${t("agreed")} · ${f.quantity(sum((m) => m.pctBp) / 100)} %`, money(sum((m) => m.amountCents)))}
          {figure(t("invoiced"), money(sum((m) => m.invoicedCents)))}
          {figure(t("collected"), money(sum((m) => m.collectedCents)), "text-good")}
          {figure(t("outstanding"), money(sum((m) => m.outstandingCents)), "text-warn")}
        </dl>
      </section>
      <ChapterLegend />
    </div>
  );
}

/** What finishing a hito's last chapter asked of Administration, newest first. */
export function InvoiceRequests({ milestones }: { milestones: ControlMilestone[] }) {
  const t = useTranslations("construction.milestones");
  const f = useControlFormat();
  const vat = useVatLabel();
  const requests = milestones
    .filter((m) => m.request)
    .sort((a, b) => b.request!.requestedAt.localeCompare(a.request!.requestedAt));

  function status(m: ControlMilestone) {
    if (m.state === "collected") return <Badge variant="good">{m.paidOn ? t("collectedOn", { date: f.date(m.paidOn) }) : t("collectedShort")}</Badge>;
    if (m.state === "invoiced") return <Badge variant="info">{m.invoicedOn ? t("invoicedOn", { date: f.date(m.invoicedOn) }) : t("invoicedShort")}</Badge>;
    return <Badge variant="yel">{t("toInvoice")}</Badge>;
  }

  return (
    <section className={cn(cardVariants({ size: "flush" }), "pt-[18px] pb-1.5")} aria-labelledby="requests-title">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-[18px] pb-3">
        <h2 id="requests-title">{t("requestsTitle")}</h2>
        <span className="text-meta text-muted-foreground">{t("requestsHint")}</span>
      </div>
      {requests.length === 0 ? (
        <p className="px-[18px] pb-4 text-sm text-muted-foreground">{t("noRequests")}</p>
      ) : (
        <>
          {/* Below 768px: one entry per request, its amount labelled. */}
          <ul className="m-0 flex list-none flex-col border-t p-0 md:hidden" aria-labelledby="requests-title">
            {requests.map((m) => {
              const request = m.request!;
              return (
                <li key={request.id} className="flex flex-col gap-1.5 border-b px-[18px] py-3 text-sm last:border-b-0">
                  <span className="flex flex-wrap items-center justify-between gap-2">
                    <span className="num font-semibold">{request.hitoCode}</span>
                    {status(m)}
                  </span>
                  <span className="leading-snug">
                    {request.description}
                    {request.clientName && <span className="text-muted-foreground"> · {request.clientName}</span>}
                  </span>
                  <span className="flex items-baseline justify-between gap-3">
                    <span className="text-meta text-muted-foreground">{vat(t("amount"), "excl")}</span>
                    <span className="num font-semibold">{f.decimal(request.amountCents / 100)}</span>
                  </span>
                  <span className="text-meta text-muted-foreground">
                    <span className="num">{f.date(request.requestedAt)}</span>{" "}
                    {t("createdBy", { code: request.chapterCode, name: request.requestedBy ?? "—" })}
                  </span>
                </li>
              );
            })}
          </ul>
          <Table className="min-w-[760px] max-md:hidden" aria-labelledby="requests-title">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-[18px]">{t("hito")}</TableHead>
                <TableHead>{t("concept")}</TableHead>
                <TableHead className="text-right">{vat(t("amount"), "excl")}</TableHead>
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
                      <span className="num">{f.date(request.requestedAt)}</span>{" "}
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
        </>
      )}
    </section>
  );
}
