import type { PurchaseForm, PurchaseKind, PurchaseRequestDetail } from "@repo/core/contract";
import { conceptAndLinesComplete, linesFromRequest, orderTotals, startChapter, type LineDraft, type ParseAmount } from "./draft";

// What the purchase request form holds (estimates as typed, the day as ""
// when empty), and how it turns into the body of createRequestAction /
// updateRequestAction. Its lines are the order form's (LineDraft); a request
// closes nothing, so `closes` is never sent.

export type RequestDraft = {
  kind: PurchaseKind;
  /** The supplier the obra suggests; "" leaves it to the office. */
  subcontractorId: string;
  description: string;
  neededBy: string;
  notes: string;
  /** The chapter whose lines the form shows. */
  chapter: string;
  /** The ticked lines, by lineage. */
  lines: Record<string, LineDraft>;
};

export function newRequestDraft(form: PurchaseForm): RequestDraft {
  return { kind: "material", subcontractorId: "", description: "", neededBy: "", notes: "", chapter: startChapter(form), lines: {} };
}

/** The request being edited as form values; `decimal` writes cents back as euros to type over. */
export function requestDraftFrom(
  request: PurchaseRequestDetail,
  form: PurchaseForm,
  { decimal }: { decimal: (euros: number) => string },
): RequestDraft {
  const { lines, chapter } = linesFromRequest(request, form, decimal);
  return {
    kind: request.kind,
    subcontractorId: request.subcontractorId ?? "",
    description: request.description,
    neededBy: request.neededBy ?? "",
    notes: request.notes ?? "",
    chapter: startChapter(form, chapter),
    lines,
  };
}

/** The estimate: the ticked lines' amounts. */
export const requestTotal = (form: PurchaseForm, draft: RequestDraft, parse: ParseAmount) => orderTotals(form, draft, parse).totalCents;

/** Whether core has what it needs: a concept and every ticked line with an estimate above zero. */
export const requestComplete = conceptAndLinesComplete;

/** The body for createRequestAction / updateRequestAction. */
export function requestInput(draft: RequestDraft, parse: ParseAmount): Record<string, unknown> {
  return {
    kind: draft.kind,
    subcontractorId: draft.subcontractorId || null,
    description: draft.description.trim(),
    neededBy: draft.neededBy || null,
    notes: draft.notes.trim() || null,
    lines: Object.entries(draft.lines).map(([lineageId, line]) => ({ lineageId, amountCents: parse(line.amount) })),
  };
}
