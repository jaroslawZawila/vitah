import { z } from "zod";
import { PLANNING_REGIONS } from "../contract";
import { calendarDate, id, integer, oneOf, optionalText, orNull } from "./fields";

// The bodies of ../planning's writes: opening a draft, saving it, approving
// it. Fields are in the order the service checked them before; what needs the
// draft (which chapters, how each starts) or the plan as a whole (its
// dependencies) is checked there, after parse.

const MAX_REASON = 500;
const MAX_LAG_DAYS = 250;
const MAX_DURATION_DAYS = 600;
const MAX_LEAD_DAYS = 365;

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
 * The draft's rules (every chapter of it, each by its code: the service
 * matches them with the draft's, then reads each by `planningRuleSchemas`),
 * its start and its calendar; what is not sent stays.
 */
export const planningEditSchema = z.object({
  items: z.array(z.looseObject({ code: z.string({ error: "invalid_input" }) }, { error: "invalid_input" }), { error: "invalid_input" }).optional(),
  ...calendarFields,
  startDate: calendarDate.optional(),
});

/** Saving the draft takes its rules. */
export const planningSaveSchema = z.object({ items: z.array(z.unknown(), { error: "invalid_input" }) });

/** What every rule says: the chapter, what it waits for (none: null or ""), its fixed start (none: null or ""). */
const ruleHead = { code: z.string({ error: "invalid_input" }), after: orNull(id), fixedStart: orNull(calendarDate) };
/** Its working days and its lead time (the draft's when missing). */
const ruleLength = {
  durationDays: integer(1, MAX_DURATION_DAYS),
  leadDays: integer(0, MAX_LEAD_DAYS).optional(),
};

/**
 * A chapter's rule, read by what the draft says of it and what it waits for:
 * 17–19 span the works (nothing else is read); one that waits for another has
 * its lag (0 when missing or null) and length; one that doesn't, its length.
 */
export const planningRuleSchemas = {
  head: z.object(ruleHead),
  after: z.object({
    ...ruleHead,
    lagDays: integer(-MAX_LAG_DAYS, MAX_LAG_DAYS)
      .nullish()
      .transform((days) => days ?? 0),
    ...ruleLength,
  }),
  own: z.object({ ...ruleHead, ...ruleLength }),
};

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
export type PlanningRuleInput = z.input<typeof planningRuleSchemas.after> & { spansWorks?: boolean };
/** POST /api/v1/projects/:id/planning/draft, createPlanningDraftAction. */
export type PlanningDraftNewInput = z.input<typeof planningSourceSchema> & Partial<z.input<typeof newPlanningSchemas.project>>;
/** PUT /api/v1/projects/:id/planning/draft, updatePlanningDraftAction (`items` required there). */
export type PlanningDraftInput = Omit<z.input<typeof planningEditSchema>, "items"> & { items?: PlanningRuleInput[] };
/** POST /api/v1/projects/:id/planning/draft/approve, approvePlanningDraftAction. */
export type PlanningApproveInput = PlanningDraftInput & { reason?: string | null };
