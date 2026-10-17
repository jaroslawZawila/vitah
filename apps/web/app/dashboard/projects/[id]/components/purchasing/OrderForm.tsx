"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import {
  PURCHASE_FLOWS,
  PURCHASE_KINDS,
  canTakeOrder,
  companyType,
  placedStatus,
  type PurchaseForm,
  type PurchaseFormLine,
  type PurchaseKind,
} from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import FormError from "../../../../components/FormError";
import { companyHref, useRequirementName } from "../../../../subcontratas/components/display";
import FileSlot from "../../../../subcontratas/empresas/nueva/steps/FileSlot";
import { deviationTone } from "../construction/format";
import { MockBadge } from "../construction/pills";
import { lineFigures, orderTotals, remainingCents, type LineDraft, type OrderDraft, type ParseAmount } from "./draft";
import { usePurchaseFormat } from "./format";
import { SupplierCaePill } from "./pills";

const option =
  "group flex min-h-11 w-full cursor-pointer items-start gap-3 rounded-[10px] border bg-card px-3.5 py-3 text-left text-[13.5px] transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50 aria-checked:border-primary aria-checked:bg-brand-soft aria-pressed:border-primary aria-pressed:bg-brand-soft";
const dot =
  "mt-0.5 size-4 flex-none rounded-full border-2 border-border bg-card group-aria-checked:border-primary group-aria-checked:shadow-[inset_0_0_0_3px_var(--card)] group-aria-checked:bg-primary group-aria-pressed:border-primary group-aria-pressed:bg-primary group-aria-pressed:shadow-[inset_0_0_0_3px_var(--card)]";
const section = cn(cardVariants(), "gap-3.5");
const check = "size-[18px] flex-none cursor-pointer accent-primary disabled:cursor-not-allowed";

/** Step 1: material or subcontract, and who from (a subcontract never goes to a material supplier). */
function KindAndSupplier({
  form,
  draft,
  onChange,
  kindLocked,
}: {
  form: PurchaseForm;
  draft: OrderDraft;
  onChange: (patch: Partial<OrderDraft>) => void;
  kindLocked: boolean;
}) {
  const t = useTranslations("purchasing.form");
  const ts = useTranslations("purchasing.status");
  const ty = useTranslations("subcontractors.fields.types");
  const tt = useTranslations("subcontractors.trades");
  const name = useRequirementName();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const suppliers = form.suppliers.filter(
    (s) =>
      canTakeOrder(s, draft.kind) &&
      (!needle || s.legalName.toLowerCase().includes(needle) || s.taxIdMasked.toLowerCase().includes(needle)),
  );
  const chosen = form.suppliers.find((s) => s.id === draft.subcontractorId);

  function pickKind(kind: PurchaseKind) {
    // A material supplier can't take a subcontract.
    const keep = !chosen || canTakeOrder(chosen, kind);
    onChange({ kind, ...(keep ? {} : { subcontractorId: "" }) });
  }

  return (
    <section className={section} aria-labelledby="form-kind">
      <h2 id="form-kind" className="text-[22px]">
        {t("kindTitle")}
      </h2>
      <div role="radiogroup" aria-label={t("kind")} className="grid gap-2.5 sm:grid-cols-2">
        {PURCHASE_KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            role="radio"
            aria-checked={draft.kind === kind}
            disabled={kindLocked && draft.kind !== kind}
            onClick={() => pickKind(kind)}
            className={option}
          >
            <span aria-hidden className={dot} />
            <span>
              <b>{t(`kinds.${kind}`)}</b>
              <br />
              <span className="text-[12.5px] text-muted-foreground">
                {PURCHASE_FLOWS[kind].map((status) => ts(status)).join(" → ")}
              </span>
            </span>
          </button>
        ))}
      </div>
      {kindLocked && <p className="text-[12.5px] text-muted-foreground">{t("kindLocked")}</p>}

      <Field>
        <Label htmlFor="form-supplier-search">{t("supplier")}</Label>
        <Input
          id="form-supplier-search"
          type="search"
          value={query}
          placeholder={t("supplierSearch")}
          onChange={(e) => setQuery(e.target.value)}
        />
        <FieldDescription>{t("supplierHint")}</FieldDescription>
      </Field>
      <div role="group" aria-label={t("suppliers")} className="flex max-h-[340px] flex-col gap-2 overflow-y-auto">
        {suppliers.length === 0 ? (
          <p className="text-[13px] text-muted-foreground">{form.suppliers.length === 0 ? t("noSuppliers") : t("noSupplierMatch")}</p>
        ) : (
          suppliers.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={draft.subcontractorId === s.id}
              onClick={() => onChange({ subcontractorId: s.id, ...(s.suppliesOnly ? { kind: "material" } : {}) })}
              className={cn(option, "items-center")}
            >
              <span aria-hidden className={dot} />
              <span className="min-w-0 flex-1">
                <b>{s.legalName}</b> <span className="num text-[12px] text-muted-foreground">{s.taxIdMasked}</span>
                <br />
                <span className="text-[12.5px] text-muted-foreground">
                  {[ty(`${companyType(s)}.label`), ...s.trades.map((trade) => tt(trade))].join(" · ")}
                </span>
              </span>
              <SupplierCaePill suppliesOnly={s.suppliesOnly} status={s.status} />
            </button>
          ))
        )}
      </div>
      {chosen && !chosen.suppliesOnly && chosen.status !== "apta" && (
        <div role="status" className="flex items-start gap-2.5 rounded-xl bg-yel-soft px-4 py-3 text-[13.5px] text-yel">
          <AlertTriangle aria-hidden className="mt-0.5 size-[18px] flex-none" />
          <p className="m-0">
            <b>{t("caeWarningTitle", { name: chosen.legalName })}</b>{" "}
            {chosen.missing.length > 0 && t("caeMissing", { documents: chosen.missing.map((id) => name(id, chosen.kind)).join(", ") })}{" "}
            {t("caeWarning")}{" "}
            <Link href={companyHref(chosen.id)} className="underline">
              {t("seeCompany")}
            </Link>
          </p>
        </div>
      )}
    </section>
  );
}

/** Step 2: the concept and the supplier's dates (never the obra's). */
function ConceptAndDates({
  form,
  draft,
  onChange,
  showOrderedOn,
}: {
  form: PurchaseForm;
  draft: OrderDraft;
  onChange: (patch: Partial<OrderDraft>) => void;
  showOrderedOn: boolean;
}) {
  const t = useTranslations("purchasing.form");
  const f = usePurchaseFormat();
  const chapter = form.chapters.find((c) => c.code === draft.chapter);
  const date = (key: "orderedOn" | "expectedOn" | "workStart" | "workEnd", props: React.ComponentProps<typeof Input> = {}) => (
    <Field>
      <Label htmlFor={`form-${key}`}>{t(key)}</Label>
      <Input id={`form-${key}`} type="date" value={draft[key]} onChange={(e) => onChange({ [key]: e.target.value })} {...props} />
      {key === "orderedOn" && <FieldDescription>{t("orderedOnHint")}</FieldDescription>}
    </Field>
  );

  return (
    <section className={section} aria-labelledby="form-concept">
      <h2 id="form-concept" className="text-[22px]">
        {t("conceptTitle")}
      </h2>
      <Field>
        <Label htmlFor="form-description">{t("description")}</Label>
        <Input
          id="form-description"
          required
          maxLength={500}
          value={draft.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </Field>
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {showOrderedOn && date("orderedOn", { max: form.today })}
        {draft.kind === "material"
          ? date("expectedOn")
          : (
              <>
                {date("workStart", { max: draft.workEnd || undefined })}
                {date("workEnd", { min: draft.workStart || undefined })}
              </>
            )}
      </div>
      <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
        {chapter?.plannedStart && chapter.plannedEnd && (
          <>
            {t("chapterPlanned", { code: chapter.code, range: f.range(chapter.plannedStart, chapter.plannedEnd) })}
            <MockBadge />
          </>
        )}
        {t("datesNote")}
      </p>
    </section>
  );
}

/** One budget line: tick it, its amount, whether it closes the line, and the deviation that leaves. */
function LineRow({
  line,
  draft,
  parse,
  onToggle,
  onChange,
}: {
  line: PurchaseFormLine;
  draft: LineDraft | undefined;
  parse: ParseAmount;
  onToggle: () => void;
  onChange: (patch: Partial<LineDraft>) => void;
}) {
  const t = useTranslations("purchasing.form");
  const f = usePurchaseFormat();
  const ticked = draft !== undefined;
  const { deviationCents } = lineFigures(line, draft, parse);

  return (
    <TableRow className={cn(!ticked && "text-muted-foreground")}>
      <TableCell className="w-11 pl-[18px]">
        <input type="checkbox" className={check} checked={ticked} onChange={onToggle} aria-label={t("include", { code: line.code })} />
      </TableCell>
      <TableCell className="max-w-[360px] min-w-[240px] whitespace-normal">
        <span className="num font-semibold text-foreground">{line.code}</span> {line.description}{" "}
        <span className="num text-[12px] text-muted-foreground">
          {f.decimal(line.quantity)} {line.unit}
        </span>
      </TableCell>
      <TableCell className="num text-right">{f.amount(line.costCents)}</TableCell>
      <TableCell className="num text-right text-muted-foreground">
        {line.contractedCents ? f.amount(line.contractedCents) : "—"}
        {line.closed && (
          <Badge variant="outline" className="ml-1.5">
            {t("alreadyClosed")}
          </Badge>
        )}
      </TableCell>
      <TableCell className="text-right">
        <Input
          inputMode="decimal"
          className="num ml-auto w-[120px] text-right"
          value={draft?.amount ?? ""}
          disabled={!ticked}
          aria-label={t("amountOf", { code: line.code })}
          onChange={(e) => onChange({ amount: e.target.value })}
        />
      </TableCell>
      <TableCell>
        <label className={cn("inline-flex min-h-10 items-center gap-2 text-[12.5px]", ticked ? "cursor-pointer" : "cursor-not-allowed")}>
          <input
            type="checkbox"
            className={check}
            checked={draft?.closes ?? false}
            disabled={!ticked}
            onChange={(e) => onChange({ closes: e.target.checked })}
            aria-label={t("closesOf", { code: line.code })}
          />
          {ticked && (draft.closes ? t("closesYes") : t("closesNo"))}
        </label>
      </TableCell>
      <TableCell className={cn("num pr-[18px] text-right", deviationTone(deviationCents))}>
        {ticked && (draft.closes ? (deviationCents === null ? "—" : f.signedDecimal(deviationCents)) : <span className="font-sans text-muted-foreground">{t("open")}</span>)}
      </TableCell>
    </TableRow>
  );
}

/** Step 3: one chapter's lines at a time; lines ticked elsewhere stay in the order. */
function Lines({
  form,
  draft,
  parse,
  onChange,
}: {
  form: PurchaseForm;
  draft: OrderDraft;
  parse: ParseAmount;
  onChange: (patch: Partial<OrderDraft>) => void;
}) {
  const t = useTranslations("purchasing.form");
  const f = usePurchaseFormat();
  const chapter = form.chapters.find((c) => c.code === draft.chapter);
  const elsewhere = form.chapters
    .filter((c) => c.code !== draft.chapter)
    .map((c) => ({ code: c.code, count: c.lines.filter((l) => draft.lines[l.lineageId]).length }))
    .filter((c) => c.count > 0);

  function toggle(line: PurchaseFormLine) {
    const { [line.lineageId]: was, ...rest } = draft.lines;
    onChange({
      lines: was ? rest : { ...draft.lines, [line.lineageId]: { amount: f.decimal(remainingCents(line) / 100), closes: true } },
    });
  }
  const setLine = (lineageId: string, patch: Partial<LineDraft>) => {
    const current = draft.lines[lineageId];
    if (current) onChange({ lines: { ...draft.lines, [lineageId]: { ...current, ...patch } } });
  };

  return (
    <section className={cn(section, "pb-2")} aria-labelledby="form-lines">
      <div className="flex flex-wrap items-end justify-between gap-2.5">
        <div>
          <h2 id="form-lines" className="text-[22px]">
            {t("linesTitle")}
          </h2>
          <p className="mt-1 text-[12.5px] text-muted-foreground">{t("linesHint")}</p>
        </div>
        <Field className="w-full sm:w-[320px]">
          <Label htmlFor="form-chapter">{t("chapter")}</Label>
          <NativeSelect id="form-chapter" className="w-full" value={draft.chapter} onChange={(e) => onChange({ chapter: e.target.value })}>
            {form.chapters.map((c) => (
              <NativeSelectOption key={c.code} value={c.code}>
                {c.code} {c.name}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </div>
      {elsewhere.length > 0 && (
        <p className="flex flex-wrap items-center gap-1.5 text-[12.5px] text-muted-foreground">
          {t("elsewhere")}
          {elsewhere.map((c) => (
            <Button key={c.code} type="button" variant="outline" size="sm" onClick={() => onChange({ chapter: c.code })}>
              {t("elsewhereChapter", { code: c.code, count: c.count })}
            </Button>
          ))}
        </p>
      )}
      <div className="-mx-[18px]">
        {!chapter || chapter.lines.length === 0 ? (
          <p className="px-[18px] py-4 text-[13px] text-muted-foreground">{t("noLines")}</p>
        ) : (
          <Table className="min-w-[900px] text-[13px]" aria-label={t("linesOf", { code: chapter.code })}>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-[18px]">
                  <span className="sr-only">{t("includeColumn")}</span>
                </TableHead>
                <TableHead>{t("line")}</TableHead>
                <TableHead className="text-right">{t("cost")}</TableHead>
                <TableHead className="text-right">{t("contracted")}</TableHead>
                <TableHead className="text-right">{t("thisOrder")}</TableHead>
                <TableHead>{t("closes")}</TableHead>
                <TableHead className="pr-[18px] text-right">{t("deviation")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {chapter.lines.map((line) => (
                <LineRow
                  key={line.lineageId}
                  line={line}
                  draft={draft.lines[line.lineageId]}
                  parse={parse}
                  onToggle={() => toggle(line)}
                  onChange={(patch) => setLine(line.lineageId, patch)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <p className="text-[12.5px] leading-normal text-muted-foreground">{t("closesNote")}</p>
    </section>
  );
}

/** Step 4 (new orders): the order or signed contract as a PDF, uploaded once the order exists. */
function DocumentPicker({ file, onChange }: { file: File | null; onChange: (file: File | null) => void }) {
  const t = useTranslations("purchasing.form");
  return (
    <section className={section} aria-labelledby="form-document">
      <h2 id="form-document" className="text-[22px]">
        {t("documentTitle")} <span className="font-sans text-[13px] font-normal tracking-normal text-muted-foreground">{t("optional")}</span>
      </h2>
      <p className="text-[13px] text-muted-foreground">{t("documentHint")}</p>
      <FileSlot
        id="form-file"
        label={t("chooseFile")}
        file={file}
        onChange={onChange}
        namespace="purchasing.form"
        errorNamespace="purchasing.errors"
      />
    </section>
  );
}

/**
 * Presentational: the new / edit order form. A new order saves as pending or
 * placed (ordered / contracted) at once; an edited one keeps its status.
 */
export default function OrderForm({
  form,
  draft,
  parse,
  onChange,
  editing,
  pending,
  error,
  onSave,
  cancelHref,
}: {
  form: PurchaseForm;
  draft: OrderDraft;
  parse: ParseAmount;
  onChange: (patch: Partial<OrderDraft>) => void;
  /** Editing an order: whether it is still pending (its kind can change, its order date isn't set yet). */
  editing?: { pending: boolean };
  pending: boolean;
  error?: string | null;
  /** `placed`: a new order saved as ordered / contracted. */
  onSave: (placed: boolean) => void;
  cancelHref: string;
}) {
  const t = useTranslations("purchasing.form");
  const f = usePurchaseFormat();
  const totals = orderTotals(form, draft, parse);
  return (
    <form
      noValidate
      aria-label={editing ? t("editLabel") : t("newLabel")}
      className="flex flex-col gap-[18px]"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(!editing);
      }}
    >
      <KindAndSupplier form={form} draft={draft} onChange={onChange} kindLocked={!!editing && !editing.pending} />
      <ConceptAndDates form={form} draft={draft} onChange={onChange} showOrderedOn={!editing || !editing.pending} />
      <Lines form={form} draft={draft} parse={parse} onChange={onChange} />
      {!editing && <DocumentPicker file={draft.file} onChange={(file) => onChange({ file })} />}

      <div
        role="region"
        aria-label={t("totalLabel")}
        className="sticky bottom-0 z-10 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border bg-card px-[18px] py-3.5 shadow-card"
      >
        <div>
          <div className="eyebrow">{t("total")}</div>
          <div className="num text-[22px] font-semibold">{f.money(totals.totalCents)}</div>
        </div>
        <div>
          <div className="eyebrow">{t("deviationOn", { count: totals.closed })}</div>
          <div className={cn("num text-base font-semibold", deviationTone(totals.deviationCents))}>
            {totals.deviationCents === null ? "—" : f.signedMoney(totals.deviationCents)}
          </div>
        </div>
        <div className="flex w-full flex-col-reverse gap-2 sm:ml-auto sm:w-auto sm:flex-row sm:flex-wrap">
          {editing ? (
            <>
              <Link href={cancelHref} className={buttonVariants({ variant: "outline" })}>
                {t("cancel")}
              </Link>
              <Button type="submit" disabled={pending}>
                {pending ? t("saving") : t("saveChanges")}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" disabled={pending} onClick={() => onSave(false)}>
                {t("savePending")}
              </Button>
              <Button type="submit" disabled={pending}>
                {pending ? t("saving") : t(`savePlaced.${placedStatus(draft.kind)}`)}
              </Button>
            </>
          )}
        </div>
        <div className="basis-full empty:hidden">
          <FormError namespace="purchasing.errors" error={error} />
        </div>
      </div>
    </form>
  );
}
