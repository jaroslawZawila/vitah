import { z } from "zod";
import { id, oneOf, optionalText, sentText } from "./fields";

// The bodies of ../budget-approvals' writes: asking the client to approve a
// revision in the app (staff) and the client's answer.

const MAX_MESSAGE = 1_000;
const MAX_REASON = 1_000;
const MAX_OPTIONS = 100;

/** Asking: a short message to the client and the options proposed as chosen (options of the revision: the service checks). */
export const askApprovalSchema = z.object({
  message: optionalText(MAX_MESSAGE),
  chosenOptionIds: z.array(id, { error: "invalid_input" }).max(MAX_OPTIONS, { error: "invalid_input" }).optional(),
});

/**
 * The client's answer. Approving needs their password (`missing_fields`
 * without one), rejecting a reason: the service checks each, in that order,
 * after the request's state.
 */
export const approvalDecisionSchema = z.object({
  decision: oneOf(["approve", "reject"] as const),
  password: sentText,
  reason: optionalText(MAX_REASON),
});

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** POST /api/v1/projects/:id/budget/revisions/:revisionId/approval, askApprovalAction. */
export type AskApprovalInput = z.input<typeof askApprovalSchema>;
/** POST /api/mobile/approvals/:id/decision. */
export type ApprovalDecisionInput = z.input<typeof approvalDecisionSchema>;
