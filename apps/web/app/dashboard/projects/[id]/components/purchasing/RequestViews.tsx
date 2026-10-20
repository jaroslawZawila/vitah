"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import {
  isOpenRequest,
  orderLabel,
  requestLabel,
  type PurchaseOrderEvent,
  type PurchaseRequestDetail,
  type PurchaseRequestListItem,
  type TenantRequests,
} from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FormActions } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import FormError from "../../../../components/FormError";
import { companyHref } from "../../../../subcontratas/components/display";
import { FilterSelect } from "../construction/Filters";
import Segmented from "../construction/Segmented";
import { Dash } from "../construction/SummaryTable";
import Kpi from "../obra/Kpi";
import { day, usePurchaseFormat } from "./format";
import { requestHref } from "./links";
import { EventText } from "./OrderViews";
import { LatePill, PurchaseKindPill, RequestStatusPill } from "./pills";

// Presentational: purchase requests (Compras › Solicitudes): the lists, a
// request's heading, decision, lines and data. The containers run the actions.

export const REQUEST_GROUPS = ["all", "pending", "approved", "closed"] as const;
export type RequestGroup = (typeof REQUEST_GROUPS)[number];

/** Which group a request is in: to decide, to order, or done with (ordered, rejected, cancelled). */
const groupOf = ({ status }: PurchaseRequestListItem): Exclude<RequestGroup, "all"> =>
  isOpenRequest(status) ? (status as "pending" | "approved") : "closed";

/** What waits for approval and what is approved but not ordered yet. */
export function RequestKpis({ summary }: { summary: TenantRequests["summary"] }) {
  const t = useTranslations("purchasing.requests.kpis");
  const f = usePurchaseFormat();
  return (
    <section aria-label={t("label")} className="grid grid-cols-2 gap-3.5 lg:max-w-[640px]">
      <Kpi
        label={t("pending")}
        value={<span className={cn(summary.pending > 0 && "text-yel")}>{summary.pending}</span>}
        className={cn(summary.pending > 0 && "border-yel/40")}
        hints={[t("amount", { amount: f.moneyRound(summary.pendingCents) })]}
      />
      <Kpi label={t("approved")} value={summary.approved} hints={[t("amount", { amount: f.moneyRound(summary.approvedCents) })]} />
    </section>
  );
}

/** "Para el 30 oct" and, when it is late, how late. */
function NeededBy({ request }: { request: PurchaseRequestListItem }) {
  const f = usePurchaseFormat();
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 whitespace-nowrap">
      <span className="num">{request.neededBy ? f.shortDay(request.neededBy) : "—"}</span>
      {request.lateDays !== null && <LatePill days={request.lateDays} />}
    </span>
  );
}

/**
 * The requests, filtered by state (and, company-wide, by obra): cards on
 * phones, a table from 768px. The company list (given `projects`) names each
 * request's obra.
 */
export function RequestBoard({
  requests,
  projects,
  empty,
}: {
  requests: PurchaseRequestListItem[];
  /** The obras to filter by: company-wide only. */
  projects?: TenantRequests["projects"];
  empty: string;
}) {
  const company = projects !== undefined;
  const hrefOf = (request: PurchaseRequestListItem) => requestHref(request.projectId, request.id);
  const t = useTranslations("purchasing.requests.list");
  const tg = useTranslations("purchasing.requests.groups");
  const tk = useTranslations("purchasing.kind");
  const f = usePurchaseFormat();
  const [group, setGroup] = useState<RequestGroup>("all");
  const [projectId, setProjectId] = useState("");
  const inProject = requests.filter((r) => !projectId || r.projectId === projectId);
  const shown = inProject.filter((r) => group === "all" || groupOf(r) === group);
  const counts = Object.fromEntries(
    REQUEST_GROUPS.map((key) => [key, key === "all" ? inProject.length : inProject.filter((r) => groupOf(r) === key).length]),
  ) as Record<RequestGroup, number>;
  const number = (request: PurchaseRequestListItem) => (
    <Link href={hrefOf(request)} className="num font-semibold text-brand-ink hover:text-primary">
      {requestLabel(request.number)}
    </Link>
  );

  return (
    <section className={cn(cardVariants({ size: "flush" }), "pt-4 pb-1.5")} aria-labelledby="requests-title">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-[18px] pb-3.5">
        <h2 id="requests-title" className="mr-1.5 text-[22px]">
          {t("title")}
        </h2>
        <Segmented
          label={tg("label")}
          value={group}
          onChange={setGroup}
          options={REQUEST_GROUPS.map((key) => ({ key, label: tg(key), count: counts[key] }))}
        />
        {company && projects.length > 1 && (
          <FilterSelect
            id="requests-project"
            label={t("project")}
            value={projectId}
            onChange={setProjectId}
            options={[{ value: "", label: t("all") }, ...projects.map((p) => ({ value: p.id, label: p.ref }))]}
          />
        )}
      </div>

      {shown.length === 0 ? (
        <p className="px-[18px] py-6 text-center text-[13.5px] text-muted-foreground">{requests.length === 0 ? empty : t("noMatch")}</p>
      ) : (
        <>
          {/* Phones: one card per request. */}
          <ul className="m-0 flex list-none flex-col gap-2.5 p-0 px-3 pb-3 md:hidden" aria-label={t("cards")}>
            {shown.map((request) => (
              <li key={request.id} className="relative rounded-xl border bg-card px-4 py-3.5 shadow-card">
                <div className="flex items-center justify-between gap-2.5">
                  <span className="num font-semibold text-brand-ink">
                    {company && <span className="font-normal text-muted-foreground">{request.projectRef} · </span>}
                    <Link href={hrefOf(request)} className="after:absolute after:inset-0 hover:text-primary">
                      {requestLabel(request.number)}
                    </Link>
                  </span>
                  <RequestStatusPill status={request.status} />
                </div>
                <div className="mt-2 font-semibold [overflow-wrap:anywhere]">{request.description}</div>
                <div className="mt-0.5 text-[13px] text-muted-foreground">
                  {tk(request.kind)} · {request.supplierName ?? t("noSupplier")}
                </div>
                <div className="mt-2.5 flex items-center justify-between gap-2.5 text-[13px]">
                  <NeededBy request={request} />
                  <span className="num font-semibold">{f.money(request.amountCents)}</span>
                </div>
              </li>
            ))}
          </ul>

          {/* From 768px: the table. */}
          <div className="hidden md:block">
            <Table className="min-w-[960px] text-[13px]" aria-label={t("table")}>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-[18px]">{company ? t("projectNumber") : t("number")}</TableHead>
                  <TableHead>{t("concept")}</TableHead>
                  <TableHead>{t("supplier")}</TableHead>
                  <TableHead className="text-right">{t("estimate")}</TableHead>
                  <TableHead>{t("neededBy")}</TableHead>
                  <TableHead>{t("requestedBy")}</TableHead>
                  <TableHead className="pr-[18px]">{t("status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map((request) => (
                  <TableRow key={request.id}>
                    <TableCell className="pl-[18px] whitespace-nowrap">
                      {company && (
                        <>
                          <span className="num text-[12px] text-muted-foreground">{request.projectRef}</span>
                          <br />
                        </>
                      )}
                      {number(request)}
                    </TableCell>
                    <TableCell className="max-w-[320px] min-w-[220px] whitespace-normal">
                      {request.description}
                      <div className="text-[12px] text-muted-foreground">
                        {tk(request.kind)}
                        {request.chapterCodes.length > 0 && ` · ${t("chapterShort", { codes: request.chapterCodes.join(", ") })}`}
                      </div>
                    </TableCell>
                    <TableCell className="min-w-[160px] whitespace-normal">{request.supplierName ?? <Dash />}</TableCell>
                    <TableCell className="num text-right">{f.amount(request.amountCents)}</TableCell>
                    <TableCell>
                      <NeededBy request={request} />
                    </TableCell>
                    <TableCell className="whitespace-normal text-muted-foreground">
                      {request.createdBy ?? "—"}
                      <div className="num text-[12px]">{f.shortDay(day(request.createdAt))}</div>
                    </TableCell>
                    <TableCell className="pr-[18px]">
                      <RequestStatusPill status={request.status} />
                      {request.order && (
                        <div className="num mt-1 text-[12px] text-muted-foreground">{orderLabel(request.order.number)}</div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      )}
    </section>
  );
}

/** "VTH-26-001 · SOL-003", status and kind; the concept; who asked and when it is needed. */
export function RequestHeading({ request, actions }: { request: PurchaseRequestDetail; actions?: React.ReactNode }) {
  const t = useTranslations("purchasing.requests.detail");
  const f = usePurchaseFormat();
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="eyebrow">{`${request.projectRef} · ${requestLabel(request.number)}`}</span>
          <RequestStatusPill status={request.status} />
          <PurchaseKindPill kind={request.kind} />
        </div>
        <h1 className="mt-1.5 [overflow-wrap:anywhere]">{request.description}</h1>
        <p className="mt-1 text-[14px] text-muted-foreground">
          {t("askedBy", { name: request.createdBy ?? "—", date: f.shortDay(day(request.createdAt)) })}
        </p>
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </header>
  );
}

/** An open request past the day it was needed by. */
export function RequestLateBanner({ request }: { request: PurchaseRequestDetail }) {
  const t = useTranslations("purchasing.requests.detail");
  const f = usePurchaseFormat();
  if (request.lateDays === null || !request.neededBy) return null;
  return (
    <div role="status" className="flex items-start gap-3 rounded-xl border border-warn/30 bg-warn-soft px-4 py-3.5 text-[13.5px] text-warn">
      <Clock aria-hidden className="mt-0.5 size-5 flex-none" />
      <p className="m-0 min-w-0">
        <b>{t("late", { days: request.lateDays })}</b> {t("lateHint", { date: f.shortDay(request.neededBy) })}
      </p>
    </div>
  );
}

/**
 * Where the decision stands: an admin approves a pending request or rejects
 * it with a reason (`onDecide`); once decided, who did and why; once ordered,
 * its order.
 */
export function DecisionCard({
  request,
  canDecide,
  orderHref,
  pending,
  error,
  onDecide,
}: {
  request: PurchaseRequestDetail;
  canDecide: boolean;
  orderHref?: string;
  pending: boolean;
  error?: string;
  onDecide: (decision: "approve" | "reject", note: string) => void;
}) {
  const t = useTranslations("purchasing.requests.decision");
  const f = usePurchaseFormat();
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState("");
  // Who decided, while that decision still stands (not for a request later withdrawn).
  const decided = request.decidedAt && request.status !== "cancelled" && (
    <p className="m-0 text-[13.5px]">
      {t(request.status === "rejected" ? "rejectedBy" : "approvedBy", {
        name: request.decidedBy ?? "—",
        date: f.shortDay(day(request.decidedAt)),
      })}
      {request.decisionNote && <span className="text-muted-foreground"> “{request.decisionNote}”</span>}
    </p>
  );

  return (
    <section
      className={cn(cardVariants(), request.status === "pending" && "border-yel/40", request.status === "approved" && "border-primary/40")}
      aria-labelledby="decision-title"
    >
      <h2 id="decision-title" className="text-[22px]">
        {t("title")}
      </h2>
      {request.status === "pending" && !canDecide && <p className="m-0 text-[13.5px] text-muted-foreground">{t("waiting")}</p>}
      {request.status === "pending" && canDecide && !rejecting && (
        <>
          <p className="m-0 text-[13.5px] text-muted-foreground">{t("hint")}</p>
          <FormActions className="md:justify-start">
            <Button type="button" disabled={pending} onClick={() => onDecide("approve", "")}>
              {t("approve")}
            </Button>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setRejecting(true)}>
              {t("reject")}
            </Button>
          </FormActions>
        </>
      )}
      {request.status === "pending" && canDecide && rejecting && (
        <form
          aria-label={t("reject")}
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (note.trim()) onDecide("reject", note.trim());
          }}
        >
          <Field>
            <Label htmlFor="reject-note">{t("reason")}</Label>
            <Input id="reject-note" required maxLength={500} value={note} placeholder={t("reasonPlaceholder")} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <FormActions>
            <Button type="button" variant="outline" onClick={() => setRejecting(false)}>
              {t("back")}
            </Button>
            <Button type="submit" variant="destructive" disabled={pending || !note.trim()}>
              {pending ? t("saving") : t("confirmReject")}
            </Button>
          </FormActions>
        </form>
      )}
      {decided}
      {request.status === "approved" && <p className="m-0 text-[13.5px] text-muted-foreground">{t("toOrder")}</p>}
      {request.status === "ordered" && request.order && (
        <p className="m-0 text-[13.5px]">
          {t("ordered")}{" "}
          {orderHref ? (
            <Link href={orderHref} className="num font-semibold text-brand-ink hover:text-primary">
              {orderLabel(request.order.number)}
            </Link>
          ) : (
            <span className="num font-semibold">{orderLabel(request.order.number)}</span>
          )}
        </p>
      )}
      {request.status === "cancelled" && <p className="m-0 text-[13.5px] text-muted-foreground">{t("cancelled")}</p>}
      <FormError namespace="purchasing.requestErrors" error={error} />
    </section>
  );
}

/** The budget lines it asks for: their cost, what the obra's orders already contract, and the estimate. */
export function RequestLines({ request }: { request: PurchaseRequestDetail }) {
  const t = useTranslations("purchasing.requests.detail");
  const f = usePurchaseFormat();
  return (
    <section className={cn(cardVariants({ size: "flush" }), "pt-4 pb-1.5")} aria-labelledby="request-lines-title">
      <h2 id="request-lines-title" className="px-[18px] pb-3 text-[22px]">
        {t("lines")}
      </h2>
      <Table className="min-w-[680px] text-[13px]">
        <TableHeader>
          <TableRow>
            <TableHead className="pl-[18px]">{t("line")}</TableHead>
            <TableHead className="text-right">{t("cost")}</TableHead>
            <TableHead className="text-right">{t("contracted")}</TableHead>
            <TableHead className="pr-[18px] text-right">{t("estimate")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {request.lines.map((line) => (
            <TableRow key={line.id}>
              <TableCell className="max-w-[380px] min-w-[260px] pl-[18px] whitespace-normal">
                <span className="num font-semibold">{line.code ?? line.chapterCode}</span> {line.description ?? t("notInBudget")}{" "}
                {line.quantity !== null && (
                  <span className="num text-[12px] text-muted-foreground">
                    {f.decimal(line.quantity)} {line.unit}
                  </span>
                )}
              </TableCell>
              <TableCell className="num text-right">{line.costCents === null ? <Dash /> : f.amount(line.costCents)}</TableCell>
              <TableCell className="num text-right text-muted-foreground">{line.contractedCents ? f.amount(line.contractedCents) : <Dash />}</TableCell>
              <TableCell className="num pr-[18px] text-right font-semibold">{f.amount(line.amountCents)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
        <TableFooter>
          <TableRow className="hover:bg-transparent">
            <TableCell className="pl-[18px]" colSpan={3}>
              {t("total")}
            </TableCell>
            <TableCell className="num pr-[18px] text-right">{f.amount(request.amountCents)}</TableCell>
          </TableRow>
        </TableFooter>
      </Table>
    </section>
  );
}

/** The request's data: needed by, the suggested supplier, notes. */
export function RequestData({ request }: { request: PurchaseRequestDetail }) {
  const t = useTranslations("purchasing.requests.detail");
  const f = usePurchaseFormat();
  const rows: [string, React.ReactNode][] = [
    [t("neededBy"), request.neededBy ? f.date(request.neededBy) : "—"],
    [
      t("supplier"),
      request.subcontractorId && request.supplierName ? (
        <Link href={companyHref(request.subcontractorId)} className="font-semibold text-brand-ink hover:text-primary">
          {request.supplierName}
        </Link>
      ) : (
        t("noSupplier")
      ),
    ],
    [t("chapters"), request.chapterCodes.join(", ") || "—"],
  ];
  if (request.notes) rows.push([t("notes"), <span key="notes" className="whitespace-pre-line">{request.notes}</span>]);
  return (
    <section className={cardVariants()} aria-labelledby="request-data-title">
      <h2 id="request-data-title" className="text-[22px]">
        {t("data")}
      </h2>
      <dl className="m-0 grid grid-cols-[minmax(0,130px)_minmax(0,1fr)] gap-x-3.5 gap-y-2.5 text-[13.5px]">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <dt className="text-muted-foreground">{label}</dt>
            <dd className="m-0 min-w-0 [overflow-wrap:anywhere]">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** One entry of a request's history: its decisions and order, else as an order's. */
export function RequestEventText({ event }: { event: PurchaseOrderEvent }) {
  const t = useTranslations("purchasing.history.request");
  switch (event.action) {
    case "approved":
    case "rejected":
    case "cancelled":
      return <b>{t(event.action)}</b>;
    case "reopened":
      return <>{t("reopened", { number: orderLabel(typeof event.detail.number === "number" ? event.detail.number : 0) })}</>;
    case "ordered":
      return <>{t("ordered", { number: orderLabel(typeof event.detail.number === "number" ? event.detail.number : 0) })}</>;
    default:
      return <EventText event={event} />;
  }
}
