import { z } from "zod";
import { MAX_PLAN_DURATION_DAYS, MAX_PLAN_LAG_DAYS, PLANNING_REGIONS } from "../contract";
import { calendarDate, id, integer, oneOf, optionalText } from "./fields";

// The bodies of ../planning's writes: opening a draft, saving it, approving
// it. Fields are in the order the service checked them before; what needs the
// draft (which chapters, which span the works) is checked there, after parse.

const MAX_REASON = 500;

/** Any object: a body that isn't one is `invalid_input` (its fields are read once the draft is known). */
export const planningBodySchema = z.object({});

/** The working calendar: each as the draft has it (a new plan: national holidays, both closures) when missing. */
const calendarFields = {
  region: oneOf(PLANNING_REGIONS).nullable().optional(),
  augustClosure: z.boolean({ error: "invalid_input" }).optional(),
  christmasClosure: z.boolean({ error: "invalid_input" }).optional(),
};

/** Where a first plan comes from: the baseline copied, the standard template, another project's baseline. */
export const planningSourceSchema = z.object({ from: oneOf(["baseline", "template", "project"]) });

/** A first plan's start: the project's when missing or null; "" is none (`missing_fields`, the service's). */
const firstStart = z.union([z.literal(""), calendarDate]).nullish();

/** A first plan, by where it comes from (a copy of the baseline reads nothing else). */
export const newPlanningSchemas = {
  template: z.object({ ...calendarFields, startDate: firstStart }),
  // Another project of the tenant (not this one: the service's check).
  project: z.object({ ...calendarFields, startDate: firstStart, projectId: id }),
};

/**
 * The draft's rules (every chapter of it, in the plan's order, each by its
 * code: the service matches them with the draft's, then reads each by
 * `planningRuleSchema`), its start and its calendar; what is not sent stays.
 */
export const planningEditSchema = z.object({
  items: z.array(z.looseObject({ code: z.string({ error: "invalid_input" }) }, { error: "invalid_input" }), { error: "invalid_input" }).optional(),
  ...calendarFields,
  startDate: calendarDate.optional(),
});

/** Saving the draft takes its rules. */
export const planningSaveSchema = z.object({ items: z.array(z.unknown(), { error: "invalid_input" }) });

/**
 * A chapter's rule (17–19, which span the works, read nothing more): its lag
 * after the chapter above it in the list (calendar days; 0 when missing or
 * null) and its working days. What an older editor also sent (what it waited
 * for, a fixed start, a lead time) is dropped: the list's order is the sequence.
 */
export const planningRuleSchema = z.object({
  code: z.string({ error: "invalid_input" }),
  lagDays: integer(-MAX_PLAN_LAG_DAYS, MAX_PLAN_LAG_DAYS)
    .nullish()
    .transform((days) => days ?? 0),
  durationDays: integer(1, MAX_PLAN_DURATION_DAYS),
});

/** Approving: why (a change to an approved plan needs it), read once the draft is known. */
export const planningReasonSchemas = {
  change: z.object({
    reason: z
      .string({ error: "change_reason_required" })
      .trim()
      .min(1, { error: "change_reason_required" })
      .max(MAX_REASON, { error: "invalid_input" }),
  }),
  first: z.object({ reason: optionalText(MAX_REASON) }),
};

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** One chapter's rule as the editor sends it (`spansWorks` is the draft's, never changed). */
export type PlanningRuleInput = z.input<typeof planningRuleSchema> & { spansWorks?: boolean };
/** POST /api/v1/projects/:id/planning/draft, createPlanningDraftAction. */
export type PlanningDraftNewInput = z.input<typeof planningSourceSchema> & Partial<z.input<typeof newPlanningSchemas.project>>;
/** PUT /api/v1/projects/:id/planning/draft, updatePlanningDraftAction (`items` required there). */
export type PlanningDraftInput = Omit<z.input<typeof planningEditSchema>, "items"> & { items?: PlanningRuleInput[] };
/** POST /api/v1/projects/:id/planning/draft/approve, approvePlanningDraftAction. */
export type PlanningApproveInput = PlanningDraftInput & { reason?: string | null };
