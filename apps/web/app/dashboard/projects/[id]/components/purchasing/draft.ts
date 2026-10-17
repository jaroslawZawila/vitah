import type { PurchaseForm, PurchaseFormLine, PurchaseKind } from "@repo/core/contract";

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
};

/** Reads typed euros into cents; NaN when it isn't an amount. */
export type ParseAmount = (text: string) => number;

/** The chapter to start on: `wanted` if the contract has it, else the first with something left to order. */
function startChapter(form: PurchaseForm, wanted?: string) {
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
  };
}

/** The order being edited (`form.editing`) as form values; `decimal` writes cents back as euros to type over. */
export function orderDraftFrom(
  order: NonNullable<PurchaseForm["editing"]>,
  form: PurchaseForm,
  decimal: (euros: number) => string,
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
  };
}

/** What a line still has to contract (never below zero): the amount a newly ticked line starts with. */
export const remainingCents = (line: PurchaseFormLine) => Math.max(0, line.costCents - line.contractedCents);

/** A ticked line's amount and, when it closes the line, cost − everything contracted (saving > 0). */
export function lineFigures(line: PurchaseFormLine, draft: LineDraft | undefined, parse: ParseAmount) {
  if (!draft) return { amountCents: null, deviationCents: null };
  const amountCents = parse(draft.amount);
  const valid = Number.isFinite(amountCents);
  return {
    amountCents: valid ? amountCents : null,
    deviationCents: draft.closes && valid ? line.costCents - line.contractedCents - amountCents : null,
  };
}

/** The order's total, and its deviation over the lines it closes. */
export function orderTotals(form: PurchaseForm, draft: OrderDraft, parse: ParseAmount) {
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

/** Whether the draft has what core needs: a supplier, a concept and every ticked line with an amount above zero. */
export function orderComplete(draft: OrderDraft, parse: ParseAmount) {
  const lines = Object.values(draft.lines);
  return (
    draft.subcontractorId !== "" &&
    draft.description.trim() !== "" &&
    lines.length > 0 &&
    lines.every((line) => parse(line.amount) > 0)
  );
}

const orNull = (value: string) => (value === "" ? null : value);

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
    lines: Object.entries(draft.lines).map(([lineageId, line]) => ({
      lineageId,
      amountCents: parse(line.amount),
      closesLine: line.closes,
    })),
  };
}
