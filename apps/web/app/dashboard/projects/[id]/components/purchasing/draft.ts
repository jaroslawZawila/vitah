import type { PurchaseForm, PurchaseFormLine, PurchaseKind, PurchaseRequestDetail, PurchaseVatKind } from "@repo/core/contract";

// What the order form holds (amounts as typed, dates as "" when empty), and
// how it turns into the body of createPurchaseAction / updatePurchaseAction.

export type LineDraft = {
  /** Euros as typed in the user's language ("3.120,00"). */
  amount: string;
  closes: boolean;
};

export type OrderDraft = {
  kind: PurchaseKind;
  subcontractorId: string;
  description: string;
  orderedOn: string;
  expectedOn: string;
  workStart: string;
  workEnd: string;
  /** The chapter whose lines the form shows; lines ticked in other chapters stay in. */
  chapter: string;
  /** The ticked lines, by lineage. */
  lines: Record<string, LineDraft>;
  /** A PDF to upload once the order exists (new orders only). */
  file: File | null;
  /** Its invoices' terms: days to pay ("" = the default), retention % as typed, VAT ("" = by kind). */
  paymentDays: string;
  retention: string;
  vatKind: PurchaseVatKind | "";
};

/** Reads typed euros into cents; NaN when it isn't an amount. */
export type ParseAmount = (text: string) => number;

/** The chapter to start on: `wanted` if the contract has it, else the first with something left to order. */
export function startChapter(form: PurchaseForm, wanted?: string) {
  const { chapters } = form;
  return (
    chapters.find((c) => c.code === wanted)?.code ??
    chapters.find((c) => c.state !== "finished" && c.lines.some((l) => l.contractedCents === 0))?.code ??
    chapters[0]?.code ??
    ""
  );
}

export function newOrderDraft(form: PurchaseForm, chapter?: string): OrderDraft {
  return {
    kind: "material",
    subcontractorId: "",
    description: "",
    orderedOn: form.today,
    expectedOn: "",
    workStart: "",
    workEnd: "",
    chapter: startChapter(form, chapter),
    lines: {},
    file: null,
    paymentDays: "",
    retention: "",
    vatKind: "",
  };
}

/** The order being edited (`form.editing`) as form values; `decimal` writes cents back as euros to type over. */
export function orderDraftFrom(
  order: NonNullable<PurchaseForm["editing"]>,
  form: PurchaseForm,
  { decimal, pctInput }: { decimal: (euros: number) => string; pctInput: (bp: number) => string },
): OrderDraft {
  const chapterOf = new Map(form.chapters.flatMap((c) => c.lines.map((l) => [l.lineageId, c.code] as const)));
  return {
    kind: order.kind,
    subcontractorId: order.subcontractorId,
    description: order.description,
    orderedOn: order.orderedOn ?? "",
    expectedOn: order.expectedOn ?? "",
    workStart: order.workStart ?? "",
    workEnd: order.workEnd ?? "",
    chapter: startChapter(form, order.lines[0] && chapterOf.get(order.lines[0].lineageId)),
    lines: Object.fromEntries(
      order.lines.map((line) => [line.lineageId, { amount: decimal(line.amountCents / 100), closes: line.closesLine }]),
    ),
    file: null,
    paymentDays: order.paymentDays === null ? "" : String(order.paymentDays),
    retention: order.retentionBp ? pctInput(order.retentionBp) : "",
    vatKind: order.vatKind ?? "",
  };
}

/**
 * A new order from an approved purchase request: its kind, supplier, concept
 * and lines with their estimates; a material request's needed-by day is the
 * delivery asked for. Everything stays editable.
 */
export function orderDraftFromRequest(
  request: PurchaseRequestDetail,
  form: PurchaseForm,
  { decimal }: { decimal: (euros: number) => string },
): OrderDraft {
  const { lines, chapter } = linesFromRequest(request, form, decimal);
  return {
    ...newOrderDraft(form, chapter),
    kind: request.kind,
    subcontractorId: request.subcontractorId ?? "",
    description: request.description,
    expectedOn: request.kind === "material" ? (request.neededBy ?? "") : "",
    lines,
  };
}

/**
 * A request's lines as the form's, each closing its budget line (a request
 * closes nothing itself), and the chapter of the first. Lines the accepted
 * budget no longer has are left out: the form couldn't show or untick them.
 */
export function linesFromRequest(request: PurchaseRequestDetail, form: PurchaseForm, decimal: (euros: number) => string) {
  const known = new Set(form.chapters.flatMap((c) => c.lines.map((l) => l.lineageId)));
  const kept = request.lines.filter((line) => known.has(line.lineageId));
  return {
    lines: Object.fromEntries(kept.map((line) => [line.lineageId, { amount: decimal(line.amountCents / 100), closes: true }])) as Record<string, LineDraft>,
    chapter: kept[0]?.chapterCode,
  };
}

/** What a line still has to contract (never below zero): the amount a newly ticked line starts with. */
export const remainingCents = (line: PurchaseFormLine) => Math.max(0, line.costCents - line.contractedCents);

/** A ticked line's amount and, when it closes the line, everything contracted − cost (overrun > 0). */
export function lineFigures(line: PurchaseFormLine, draft: LineDraft | undefined, parse: ParseAmount) {
  if (!draft) return { amountCents: null, deviationCents: null };
  const amountCents = parse(draft.amount);
  const valid = Number.isFinite(amountCents);
  return {
    amountCents: valid ? amountCents : null,
    deviationCents: draft.closes && valid ? line.contractedCents + amountCents - line.costCents : null,
  };
}

/** The order's (or a request's) total, and its deviation over the lines it closes. */
export function orderTotals(form: PurchaseForm, draft: Pick<OrderDraft, "lines">, parse: ParseAmount) {
  let totalCents = 0;
  let closed = 0;
  let deviationCents = 0;
  for (const line of form.chapters.flatMap((c) => c.lines)) {
    const ticked = draft.lines[line.lineageId];
    if (!ticked) continue;
    const figures = lineFigures(line, ticked, parse);
    totalCents += figures.amountCents ?? 0;
    if (figures.deviationCents !== null) {
      closed++;
      deviationCents += figures.deviationCents;
    }
  }
  return { totalCents, closed, deviationCents: closed > 0 ? deviationCents : null };
}

/** A concept and every ticked line with an amount above zero: what an order and a request both need. */
export function conceptAndLinesComplete(draft: Pick<OrderDraft, "description" | "lines">, parse: ParseAmount) {
  const lines = Object.values(draft.lines);
  return draft.description.trim() !== "" && lines.length > 0 && lines.every((line) => parse(line.amount) > 0);
}

/** Whether the draft has what core needs: a supplier, a concept and every ticked line with an amount above zero. */
export const orderComplete = (draft: OrderDraft, parse: ParseAmount) =>
  draft.subcontractorId !== "" && conceptAndLinesComplete(draft, parse);

const orNull = (value: string) => (value === "" ? null : value);

/** The ticked lines as core takes them: amount in cents and whether each closes its budget line. */
export const linesInput = (draft: Pick<OrderDraft, "lines">, parse: ParseAmount) =>
  Object.entries(draft.lines).map(([lineageId, line]) => ({ lineageId, amountCents: parse(line.amount), closesLine: line.closes }));

/**
 * The body for createPurchaseAction / updatePurchaseAction. The order date is
 * sent once the order is placed (`placed`); a pending one gets it when marked.
 */
export function orderInput(draft: OrderDraft, parse: ParseAmount, placed: boolean): Record<string, unknown> {
  const material = draft.kind === "material";
  return {
    kind: draft.kind,
    subcontractorId: draft.subcontractorId,
    description: draft.description.trim(),
    ...(placed ? { orderedOn: orNull(draft.orderedOn) } : {}),
    expectedOn: material ? orNull(draft.expectedOn) : null,
    workStart: material ? null : orNull(draft.workStart),
    workEnd: material ? null : orNull(draft.workEnd),
    lines: linesInput(draft, parse),
    // A whole number of days; anything else is refused by core.
    paymentDays: draft.paymentDays.trim() === "" ? null : /^\d+$/.test(draft.paymentDays.trim()) ? Number(draft.paymentDays.trim()) : NaN,
    // A % in hundredths is basis points.
    retentionBp: draft.retention.trim() === "" ? 0 : parse(draft.retention),
    vatKind: draft.vatKind || null,
  };
}
