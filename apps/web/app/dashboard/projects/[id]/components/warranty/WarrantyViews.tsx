"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { ChevronRight } from "lucide-react";
import type { VariantProps } from "class-variance-authority";
import {
  MAX_WARRANTY_ANSWER,
  STAFF_WARRANTY_STATUSES,
  warrantyRef,
  type StaffWarrantyStatus,
  type WarrantyClaim,
  type WarrantyClaimSummary,
  type WarrantyCoverageInfo,
  type WarrantyError,
  type WarrantyEvent,
  type WarrantyStatus,
} from "@repo/core/contract";
import { Badge, type badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FieldDescription, FormActions, FormMessage } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { useFormat } from "@/lib/format";
import { cn } from "@/lib/utils";
import FormError from "../../../../components/FormError";
import { cardHead, muted } from "../obra/classes";

// Presentational: the project's Garantía tab, the warranty claims the client
// sends from the app. The containers (../../garantia) call the actions.

type Variant = NonNullable<VariantProps<typeof badgeVariants>["variant"]>;

const STATUS_TONE: Record<WarrantyStatus, Variant> = {
  received: "info",
  in_review: "yel",
  scheduled: "default",
  resolved: "good",
  rejected: "destructive",
  cancelled: "outline",
};

export function WarrantyStatusPill({ status }: { status: WarrantyStatus }) {
  const t = useTranslations("warranty.status");
  return <Badge variant={STATUS_TONE[status]}>{t(status)}</Badge>;
}

function UrgentPill() {
  const t = useTranslations("warranty.claim");
  return <Badge variant="warn">{t("urgent")}</Badge>;
}

/** The hand-over day and the three LOE periods (1 year finishes, 3 habitability, 10 structure). */
export function CoverageCard({ info }: { info: WarrantyCoverageInfo }) {
  const t = useTranslations("warranty.coverage");
  const f = useFormat();
  return (
    <section className={cn(cardVariants(), "gap-3")} aria-labelledby="warranty-coverage-title">
      <div className={cardHead}>
        <h2 id="warranty-coverage-title">{t("title")}</h2>
        {info.handedOver && (
          <span className={muted}>
            {info.handoverOn && info.handoverSource
              ? t("handover", { date: f.date(info.handoverOn), source: t(`source.${info.handoverSource}`) })
              : t("noDate")}
          </span>
        )}
      </div>
      {!info.handedOver && <p className="text-sm text-muted-foreground">{t("notHandedOver")}</p>}
      <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 sm:grid-cols-3">
        {info.coverage.map((period) => (
          <li key={period.scope} className="flex flex-col gap-0.5 rounded-[10px] border px-3 py-2.5">
            <span className="text-sm font-semibold">{t("years", { count: period.years })}</span>
            <span className="text-sm">{t(`scope.${period.scope}`)}</span>
            {period.endsOn && (
              <span className={cn("num", muted, !period.active && "text-bad")}>
                {t(period.active ? "until" : "expired", { date: f.date(period.endsOn) })}
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The claims, newest first: each opens its page. */
export function ClaimList({ claims, href }: { claims: WarrantyClaimSummary[]; href: (claim: WarrantyClaimSummary) => string }) {
  const t = useTranslations("warranty");
  const f = useFormat();
  return (
    <ul className={cn(cardVariants({ size: "flush" }), "m-0 list-none p-0")}>
      {claims.map((claim) => (
        <li key={claim.id} className="border-b last:border-b-0">
          <Link
            href={href(claim)}
            className="flex min-h-11 items-center gap-3 px-4 py-3 transition-colors hover:bg-raise"
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="num text-sm font-semibold">{warrantyRef(claim.number)}</span>
                <span className="text-sm">
                  {t(`kind.${claim.kind}`)} · {t(`room.${claim.room}`)}
                </span>
                <WarrantyStatusPill status={claim.status} />
                {claim.urgent && <UrgentPill />}
              </div>
              <p className="line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]">{claim.description}</p>
              <p className={cn("num", muted)}>
                {t("list.sent", { date: f.date(claim.createdAt) })}
                {claim.visitOn && ` · ${t("list.visit", { date: f.date(claim.visitOn) })}`}
                {claim.photoCount > 0 && ` · ${t("list.photos", { count: claim.photoCount })}`}
              </p>
            </div>
            <ChevronRight aria-hidden className="size-4 flex-none text-muted-foreground" />
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** What the client sent: kind, room, description and photos (each opens full size). */
export function ClaimFacts({ claim, photoUrl }: { claim: WarrantyClaim; photoUrl: (photoId: string, thumb: boolean) => string }) {
  const t = useTranslations("warranty");
  const f = useFormat();
  return (
    <section className={cn(cardVariants(), "gap-3")} aria-labelledby="warranty-claim-facts">
      <div className={cardHead}>
        <h2 id="warranty-claim-facts">{t("claim.title")}</h2>
        <span className="flex flex-wrap gap-2">
          <WarrantyStatusPill status={claim.status} />
          {claim.urgent && <UrgentPill />}
        </span>
      </div>
      <p className={muted}>
        {t("claim.sentBy", { name: claim.createdBy ?? t("claim.client"), date: f.dateTime(claim.createdAt) })}
      </p>
      <dl className="m-0 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className={muted}>{t("claim.kind")}</dt>
          <dd className="m-0">{t(`kind.${claim.kind}`)}</dd>
        </div>
        <div>
          <dt className={muted}>{t("claim.room")}</dt>
          <dd className="m-0">{t(`room.${claim.room}`)}</dd>
        </div>
      </dl>
      <p className="text-sm whitespace-pre-line [overflow-wrap:anywhere]">{claim.description}</p>
      {claim.photoIds.length > 0 ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {claim.photoIds.map((photoId, index) => (
            <a key={photoId} href={photoUrl(photoId, false)} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element -- served by our API with the session */}
              <img
                src={photoUrl(photoId, true)}
                alt={t("claim.photo", { number: index + 1 })}
                className="block aspect-square w-full rounded-md border bg-raise object-cover"
                loading="lazy"
              />
            </a>
          ))}
        </div>
      ) : (
        <p className={muted}>{t("claim.noPhotos")}</p>
      )}
      {(claim.answer || claim.visitOn) && (
        <div className="flex flex-col gap-1 border-t pt-3 text-sm">
          {claim.visitOn && <p className="num">{t("list.visit", { date: f.date(claim.visitOn) })}</p>}
          {claim.answer && (
            <p className="whitespace-pre-line [overflow-wrap:anywhere]">
              <span className={muted}>{t("claim.answer")}: </span>
              {claim.answer}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/** What staff send: the status, the visit day and the answer the client reads in the app. */
export type ClaimValues = { status: StaffWarrantyStatus; visitOn: string | null; answer: string | null };

/** Staff's form: moves the claim on and answers the client. A cancelled claim only says so. */
export function ClaimForm({
  claim,
  pending,
  error,
  saved,
  onSubmit,
}: {
  claim: WarrantyClaim;
  pending: boolean;
  error?: WarrantyError;
  saved: boolean;
  onSubmit: (values: ClaimValues) => void;
}) {
  const t = useTranslations("warranty");
  if (claim.status === "cancelled") {
    return (
      <section className={cn(cardVariants(), "gap-2")}>
        <h2>{t("form.title")}</h2>
        <p className="text-sm text-muted-foreground">{t("form.cancelled")}</p>
      </section>
    );
  }
  return (
    <form
      aria-label={t("form.title")}
      className={cn(cardVariants(), "flex flex-col gap-3.5")}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const text = (name: string) => String(data.get(name) ?? "").trim() || null;
        onSubmit({ status: text("status") as StaffWarrantyStatus, visitOn: text("visitOn"), answer: text("answer") });
      }}
    >
      <h2>{t("form.title")}</h2>
      <Field>
        <Label htmlFor="warranty-status">{t("form.status")}</Label>
        <NativeSelect id="warranty-status" name="status" defaultValue={claim.status}>
          {STAFF_WARRANTY_STATUSES.map((status) => (
            <NativeSelectOption key={status} value={status}>
              {t(`status.${status}`)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </Field>
      <Field>
        <Label htmlFor="warranty-visit">{t("form.visitOn")}</Label>
        <Input id="warranty-visit" name="visitOn" type="date" className="num" defaultValue={claim.visitOn ?? ""} />
        <FieldDescription>{t("form.visitHint")}</FieldDescription>
      </Field>
      <Field>
        <Label htmlFor="warranty-answer">{t("form.answer")}</Label>
        <Textarea id="warranty-answer" name="answer" rows={4} maxLength={MAX_WARRANTY_ANSWER} defaultValue={claim.answer ?? ""} />
        <FieldDescription>{t("form.answerHint")}</FieldDescription>
      </Field>
      <FormError namespace="warranty.errors" error={error} />
      {saved && !pending && (
        <FormMessage tone="success" role="status">
          {t("form.saved")}
        </FormMessage>
      )}
      <FormActions>
        <Button type="submit" disabled={pending}>
          {t("form.save")}
        </Button>
      </FormActions>
    </form>
  );
}

/** One step of the claim in words. */
function EventText({ event }: { event: WarrantyEvent }) {
  const t = useTranslations("warranty");
  const f = useFormat();
  if (event.action !== "updated") return t(`history.${event.action}`);
  const { status, visitOn, answer } = event.detail;
  const parts = [
    status && t("history.status", { from: t(`status.${status.from}`), to: t(`status.${status.to}`) }),
    visitOn && (visitOn.to ? t("history.visit", { date: f.date(visitOn.to) }) : t("history.visitCleared")),
    answer && (answer.to ? t("history.answer", { text: answer.to }) : t("history.answerCleared")),
  ].filter(Boolean);
  return parts.join(" · ");
}

/** Every step of the claim, newest first, with who did it: the client or a staff member. */
export function ClaimHistory({ events }: { events: WarrantyEvent[] }) {
  const t = useTranslations("warranty.history");
  const f = useFormat();
  return (
    <section className={cardVariants()} aria-labelledby="warranty-history-title">
      <h2 id="warranty-history-title">{t("title")}</h2>
      <ul className="m-0 list-none p-0" aria-labelledby="warranty-history-title">
        {[...events].reverse().map((event) => (
          <li key={event.id} className="grid gap-x-4 gap-y-0.5 border-b py-2.5 text-sm last:border-b-0 sm:grid-cols-[150px_minmax(0,1fr)]">
            <time dateTime={event.at} className="num text-meta text-muted-foreground">
              {f.dateTime(event.at)}
            </time>
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <EventText event={event} />
              <span className={cn("block", muted)}>{event.by ?? (event.byClient ? t("client") : t("someone"))}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
