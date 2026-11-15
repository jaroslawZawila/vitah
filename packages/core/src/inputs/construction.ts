import { z } from "zod";
import { ISSUE_KINDS, ISSUE_PARTIES, ISSUE_STATUSES, MAX_CHAPTER_CODE, MAX_ISSUE_TEXT } from "../contract";
import { MAX_TEXT } from "../input";
import { MAX_AMOUNT_CENTS } from "../money";
import { cents, integer, oneOf, optionalText, orNull, present, requiredText, workDate, type WithIdempotencyKey } from "./fields";

// The bodies of ../construction's writes: a chapter's actual dates, and the
// issues and changes log. Fields are in the order the service checked them
// before; whether a chapter is the contract's is checked there, after parse.

const MAX_NOTE = 500;
const MAX_IMPACT_DAYS = 3650;

/** The day work started or finished on a chapter (may be before today, never after). */
export const chapterDateSchema = z.object({ date: workDate });

/**
 * A correction of a chapter's recorded dates: each a day, or null (or "") to
 * clear it; a date not sent stays. The note is read first; the dates once the
 * chapter is known to have any (the service's check).
 */
export const chapterCorrectionSchema = z.object({
  note: optionalText(MAX_NOTE),
  actualStart: orNull(workDate).optional(),
  actualEnd: orNull(workDate).optional(),
});

/** An issue's fields, as an edit takes them; the impacts are estimates (null or "": none). */
const issueFields = {
  kind: oneOf(ISSUE_KINDS),
  occurredOn: workDate,
  chapterCode: requiredText(MAX_CHAPTER_CODE),
  description: requiredText(MAX_ISSUE_TEXT),
  party: oneOf(ISSUE_PARTIES),
  partyName: optionalText(MAX_TEXT),
  costImpactCents: orNull(cents(-MAX_AMOUNT_CENTS)),
  scheduleImpactDays: orNull(integer(-MAX_IMPACT_DAYS, MAX_IMPACT_DAYS)),
  status: oneOf(ISSUE_STATUSES),
};

/** A new issue or change: kind, day, chapter, description and party required; pending unless told otherwise. */
export const newIssueSchema = z.object({
  ...issueFields,
  kind: present(issueFields.kind),
  occurredOn: present(issueFields.occurredOn),
  party: present(issueFields.party),
  status: issueFields.status.default("pending"),
});

/** An issue's changes: any of its fields, status included. */
export const issueChangesSchema = z.object({
  kind: issueFields.kind.optional(),
  occurredOn: issueFields.occurredOn.optional(),
  chapterCode: issueFields.chapterCode.optional(),
  description: issueFields.description.optional(),
  party: issueFields.party.optional(),
  partyName: issueFields.partyName.optional(),
  costImpactCents: issueFields.costImpactCents.optional(),
  scheduleImpactDays: issueFields.scheduleImpactDays.optional(),
  status: issueFields.status.optional(),
});

/** The issues list: one kind (all when missing). */
export const issueListSchema = z.object({ kind: oneOf(ISSUE_KINDS).optional() });

// ─── What callers send (re-exported by ../contract, types only) ──────────────

/** POST /api/v1/projects/:id/obra/chapters/:code/{start,finish}, startChapterAction, finishChapterAction. */
export type ChapterDateInput = z.input<typeof chapterDateSchema>;
/** PATCH /api/v1/projects/:id/obra/chapters/:code/control, correctChapterAction. */
export type ChapterCorrectionInput = z.input<typeof chapterCorrectionSchema>;
/** POST /api/v1/projects/:id/obra/issues, createIssueAction. */
export type ObraIssueInput = WithIdempotencyKey & z.input<typeof newIssueSchema>;
/** PATCH /api/v1/projects/:id/obra/issues/:issueId, updateIssueAction. */
export type ObraIssueChangesInput = z.input<typeof issueChangesSchema>;
