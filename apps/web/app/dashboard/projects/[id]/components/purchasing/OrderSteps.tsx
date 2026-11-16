"use client";

// Presentational: the order form's kind-and-supplier and lines steps, shared
// with the purchase request form (RequestForm) and a modificado (OrderAmendmentViews).

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle } from "lucide-react";
import {
  PURCHASE_FLOWS,
  PURCHASE_KINDS,
  canTakeOrder,
  companyType,
  type PurchaseForm,
  type PurchaseFormLine,
  type PurchaseKind,
} from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { Field, FieldDescription } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { companyHref, useRequirementName } from "../../../../subcontratas/components/display";
import { deviationTone } from "../construction/format";
import { lineFigures, remainingCents, type LineDraft, type OrderDraft, type ParseAmount } from "./draft";
import { usePurchaseFormat } from "./format";
import { SupplierCaePill } from "./pills";
import { phoneLabel, phoneLine } from "../../../../components/phone-table";

const option =
  "group flex min-h-11 w-full cursor-pointer items-start gap-3 rounded-[10px] border bg-card px-3.5 py-3 text-left text-sm transition-colors hover:border-primary/50 disabled:cursor-not-allowed disabled:opacity-50 aria-checked:border-primary aria-checked:bg-brand-soft aria-pressed:border-primary aria-pressed:bg-brand-soft";
const dot =
  "mt-0.5 size-4 flex-none rounded-full border-2 border-border bg-card group-aria-checked:border-primary group-aria-checked:shadow-[inset_0_0_0_3px_var(--card)] group-aria-checked:bg-primary group-aria-pressed:border-primary group-aria-pressed:bg-primary group-aria-pressed:shadow-[inset_0_0_0_3px_var(--card)]";
export const section = cn(cardVariants(), "gap-3.5");
const check = "size-[18px] flex-none cursor-pointer accent-primary disabled:cursor-not-allowed";

/**
 * Below 768px the lines table reflows into one card per line (the same elements,
 * so one set of inputs): the tick and the line on top, then each figure on a row
 * of its own with its column's name, which the table says in its heading.
 */
const phone = {
  table: "max-md:block",
  row: "max-md:grid max-md:grid-cols-[44px_minmax(0,1fr)] max-md:items-center max-md:gap-x-2 max-md:gap-y-1 max-md:px-[18px] max-md:py-2.5",
  cell: `max-md:col-start-2 ${phoneLine} max-md:text-right`,
  label: phoneLabel,
};

/** What the kind and supplier step reads and writes: an order's or a purchase request's. */
type KindDraft = Pick<OrderDraft, "kind" | "subcontractorId">;

/**
 * Step 1: material or subcontract, and who from (a subcontract never goes to
 * a material supplier). With `supplierOptional` (a purchase request), picking
 * the chosen supplier again leaves it to the office.
 */
export function KindAndSupplier({
  form,
  draft,
  onChange,
  kindLocked,
  supplierOptional = false,
}: {
  form: PurchaseForm;
  draft: KindDraft;
  onChange: (patch: Partial<KindDraft>) => void;
  kindLocked: boolean;
  supplierOptional?: boolean;
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
              <span className="text-meta text-muted-foreground">
                {PURCHASE_FLOWS[kind].map((status) => ts(status)).join(" → ")}
              </span>
            </span>
          </button>
        ))}
      </div>
      {kindLocked && <p className="text-meta text-muted-foreground">{t("kindLocked")}</p>}

      <Field>
        <Label htmlFor="form-supplier-search">{t("supplier")}</Label>
        <Input
          id="form-supplier-search"
          type="search"
          value={query}
          placeholder={t("supplierSearch")}
          onChange={(e) => setQuery(e.target.value)}
        />
        <FieldDescription>{supplierOptional ? t("supplierOptionalHint") : t("supplierHint")}</FieldDescription>
      </Field>
      <div role="group" aria-label={t("suppliers")} className="flex max-h-[340px] flex-col gap-2 overflow-y-auto">
        {suppliers.length === 0 ? (
          <p className="text-sm text-muted-foreground">{form.suppliers.length === 0 ? t("noSuppliers") : t("noSupplierMatch")}</p>
        ) : (
          suppliers.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed={draft.subcontractorId === s.id}
              onClick={() =>
                supplierOptional && draft.subcontractorId === s.id
                  ? onChange({ subcontractorId: "" })
                  : onChange({ subcontractorId: s.id, ...(s.suppliesOnly ? { kind: "material" } : {}) })
              }
              className={cn(option, "flex-none items-center")}
            >
              <span aria-hidden className={dot} />
              <span className="min-w-0 flex-1">
                <b>{s.legalName}</b> <span className="num text-meta text-muted-foreground">{s.taxIdMasked}</span>
                <br />
                <span className="text-meta text-muted-foreground">
                  {[ty(`${companyType(s)}.label`), ...s.trades.map((trade) => tt(trade))].join(" · ")}
                </span>
              </span>
              <SupplierCaePill suppliesOnly={s.suppliesOnly} status={s.status} />
            </button>
          ))
        )}
      </div>
      {chosen && !chosen.suppliesOnly && chosen.status !== "apta" && (
        <div role="status" className="flex items-start gap-2.5 rounded-xl bg-yel-soft px-4 py-3 text-sm text-yel">
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

/**
 * One budget line: tick it, its amount, whether it closes the line, and the
 * deviation that leaves; an `estimate` (a purchase request) only its amount.
 */
function LineRow({
  line,
  draft,
  parse,
  estimate,
  onToggle,
  onChange,
}: {
  line: PurchaseFormLine;
  draft: LineDraft | undefined;
  parse: ParseAmount;
  estimate: boolean;
  onToggle: () => void;
  onChange: (patch: Partial<LineDraft>) => void;
}) {
  const t = useTranslations("purchasing.form");
  const f = usePurchaseFormat();
  const ticked = draft !== undefined;
  const { deviationCents } = lineFigures(line, draft, parse);

  return (
    <TableRow className={cn(phone.row, !ticked && "text-muted-foreground")}>
      <TableCell className="w-11 pl-[18px] max-md:p-0">
        <label className="cursor-pointer pointer-coarse:flex pointer-coarse:min-h-11 pointer-coarse:min-w-11 pointer-coarse:items-center">
          <input type="checkbox" className={check} checked={ticked} onChange={onToggle} aria-label={t("include", { code: line.code })} />
        </label>
      </TableCell>
      <TableCell className="max-w-[360px] min-w-[240px] whitespace-normal max-md:max-w-none max-md:min-w-0 max-md:p-0">
        <span className="num font-semibold text-foreground">{line.code}</span> {line.description}{" "}
        <span className="num text-meta text-muted-foreground">
          {f.decimal(line.quantity)} {line.unit}
        </span>
      </TableCell>
      <TableCell className={cn("num text-right", phone.cell)}>
        <span className={phone.label}>{t("cost")}</span>
        {f.amount(line.costCents)}
      </TableCell>
      <TableCell className={cn("num text-right text-muted-foreground", phone.cell)}>
        <span className={phone.label}>{t("contracted")}</span>
        <span>
          {line.contractedCents ? f.amount(line.contractedCents) : "—"}
          {line.closed && (
            <Badge variant="outline" className="ml-1.5">
              {t("alreadyClosed")}
            </Badge>
          )}
        </span>
      </TableCell>
      <TableCell className={cn("text-right", estimate && "pr-[18px]", phone.cell, !ticked && "max-md:hidden")}>
        <span className={phone.label}>{estimate ? t("estimate") : t("thisOrder")}</span>
        <Input
          inputMode="decimal"
          className="num ml-auto w-[120px] text-right"
          value={draft?.amount ?? ""}
          disabled={!ticked}
          aria-label={t("amountOf", { code: line.code })}
          onChange={(e) => onChange({ amount: e.target.value })}
        />
      </TableCell>
      {!estimate && (
        <>
          <TableCell className={cn(phone.cell, "max-md:justify-start", !ticked && "max-md:hidden")}>
            <label className={cn("inline-flex min-h-10 items-center gap-2 text-meta pointer-coarse:min-h-11 pointer-coarse:min-w-11", ticked ? "cursor-pointer" : "cursor-not-allowed")}>
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
          <TableCell className={cn("num pr-[18px] text-right", deviationTone(deviationCents), phone.cell, !ticked && "max-md:hidden")}>
            <span className={phone.label}>{t("deviation")}</span>
            {ticked && (draft.closes ? (deviationCents === null ? "—" : f.signedAmount(deviationCents)) : <span className="font-sans text-muted-foreground">{t("open")}</span>)}
          </TableCell>
        </>
      )}
    </TableRow>
  );
}

/** What the lines step reads and writes: an order's or a purchase request's. */
type LinesDraft = Pick<OrderDraft, "chapter" | "lines">;

/**
 * Step 3: one chapter's lines at a time; lines ticked elsewhere stay in the
 * order. An `estimate` (a purchase request) asks only for amounts.
 */
export function Lines({
  form,
  draft,
  parse,
  onChange,
  estimate = false,
  title,
}: {
  form: PurchaseForm;
  draft: LinesDraft;
  parse: ParseAmount;
  onChange: (patch: Partial<LinesDraft>) => void;
  estimate?: boolean;
  /** Its heading, when the form numbers its steps otherwise. */
  title?: string;
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
            {title ?? t("linesTitle")}
          </h2>
          <p className="mt-1 text-meta text-muted-foreground">{estimate ? t("estimateHint") : t("linesHint")}</p>
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
        <p className="flex flex-wrap items-center gap-1.5 text-meta text-muted-foreground">
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
          <p className="px-[18px] py-4 text-sm text-muted-foreground">{t("noLines")}</p>
        ) : (
          <Table className={cn(phone.table, estimate ? "md:min-w-[640px]" : "md:min-w-[900px]")} aria-label={t("linesOf", { code: chapter.code })}>
            <TableHeader className="max-md:hidden">
              <TableRow>
                <TableHead className="pl-[18px]">
                  <span className="sr-only">{t("includeColumn")}</span>
                </TableHead>
                <TableHead>{t("line")}</TableHead>
                <TableHead className="text-right">{t("cost")}</TableHead>
                <TableHead className="text-right">{t("contracted")}</TableHead>
                {estimate ? (
                  <TableHead className="pr-[18px] text-right">{t("estimate")}</TableHead>
                ) : (
                  <>
                    <TableHead className="text-right">{t("thisOrder")}</TableHead>
                    <TableHead>{t("closes")}</TableHead>
                    <TableHead className="pr-[18px] text-right">{t("deviation")}</TableHead>
                  </>
                )}
              </TableRow>
            </TableHeader>
            <TableBody className="max-md:block">
              {chapter.lines.map((line) => (
                <LineRow
                  key={line.lineageId}
                  line={line}
                  draft={draft.lines[line.lineageId]}
                  parse={parse}
                  estimate={estimate}
                  onToggle={() => toggle(line)}
                  onChange={(patch) => setLine(line.lineageId, patch)}
                />
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      {!estimate && <p className="text-meta leading-normal text-muted-foreground">{t("closesNote")}</p>}
    </section>
  );
}
