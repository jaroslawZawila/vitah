import {
  and,
  asc,
  budgetChapters,
  budgetLines,
  budgetRevisions,
  db,
  eq,
  obraHitoChapters,
  obraHitoChecks,
  obraHitoPhotos,
  obraHitos,
  users,
  obraChapterProgress,
  obraInvoiceRequests,
  sql,
  type AnyColumn,
  type PgTable,
  type SQL,
} from "@repo/db";
import { isCalendarDate } from "./calendar";
import {
  amountCents,
  type BudgetLine,
  type OptionKind,
  type Hito,
  type ObraError,
  type ObraStage,
} from "./contract";
import { CoreError } from "./errors";
import { hitoStatus, ofBp, paymentDueOn, priceLines, progressOf, todayInSpain, type Margins, type Progress } from "./obra-calc";
import { requireProject as requireProjectRow } from "./project-files";
import { clientProjectWhere } from "./project-client";

// ─── Obra: shared loading and checks ─────────────────────────────────────────
// What the budget, hitos and obra services share: errors, input parsing, and
// loading a project's current budget and hitos into their computed shapes.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS: Record<ObraError, number> = {
  fixed_chapters: 409,
  not_issued: 409,
  change_reason_required: 400,
  generation_running: 409,
  ai_limit_reached: 429,
  too_many_pages: 400,
  no_documents: 400,
  missing_fields: 400,
  invalid_input: 400,
  invalid_stage: 400,
  invalid_date: 400,
  invalid_state: 409,
  missing_file: 400,
  invalid_file_type: 400,
  file_too_large: 413,
  duplicate_code: 409,
  unknown_chapter: 400,
  unknown_line: 400,
  unknown_supplier: 400,
  supplies_only: 409,
  budget_exists: 409,
  draft_exists: 409,
  not_draft: 409,
  not_accepted: 409,
  no_budget: 404,
  project_not_found: 404,
  not_found: 404,
  forbidden: 403,
};

export function fail(code: ObraError): never {
  throw new CoreError(code, STATUS[code]);
}

// Project lookup is the same as for the project's files.
export const requireProject = requireProjectRow;
export type ObraProject = Awaited<ReturnType<typeof requireProjectRow>>;

/** The project attached to a mobile-app client, if any. */
export async function clientProject(tenantId: string, clientUserId: string) {
  const project = await db.query.projects.findFirst({
    where: clientProjectWhere(tenantId, clientUserId),
    columns: { id: true, obraStage: true, startDate: true, completionDate: true },
  });
  return project ?? null;
}

export const asStage = (stage: number) => stage as ObraStage;

// ─── Input parsing ───────────────────────────────────────────────────────────

/** A trimmed, non-empty string of at most `max` characters. */
export function requiredText(value: unknown, max: number): string {
  if (typeof value !== "string" || !value.trim()) fail("missing_fields");
  const text = value.trim();
  if (text.length > max) fail("invalid_input");
  return text;
}

/** A trimmed string, or null when empty. */
export function optionalText(value: unknown, max: number): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") fail("invalid_input");
  const text = value.trim();
  if (text.length > max) fail("invalid_input");
  return text || null;
}

/** An integer within [min, max]. */
export function integer(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
    fail("invalid_input");
  }
  return value;
}

/** A number within [0, max] with up to log10(factor) decimals, stored × factor. */
export function scaled(value: unknown, max: number, factor: number): number {
  if (value === undefined) fail("missing_fields");
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > max) {
    fail("invalid_input");
  }
  return Math.round(value * factor);
}

/** A calendar date, YYYY-MM-DD. */
export function calendarDate(value: unknown): string {
  if (typeof value !== "string" || !isCalendarDate(value)) fail("invalid_date");
  return value;
}

/** A day something happened on site: a calendar date, not after today (in Spain). */
export function workDate(value: unknown, today = todayInSpain()): string {
  const date = calendarDate(value);
  if (date > today) fail("invalid_date");
  return date;
}

/** Null when missing or empty; else as `parse` reads it. */
export const orNull =
  <T>(parse: (value: unknown) => T) =>
  (value: unknown): T | null =>
    value === undefined || value === null || value === "" ? null : parse(value);

/** One of `allowed`; `invalid_input` otherwise. */
export const pick =
  <T extends string>(allowed: readonly T[]) =>
  (value: unknown): T =>
    allowed.find((a) => a === value) ?? fail("invalid_input");

export const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Who did something: their name, else their email. */
export const userName = sql<string | null>`coalesce(${users.name}, ${users.email})`;

/**
 * The columns a partial update sets: each parser runs only for the keys
 * present in `input` (so `{}` changes nothing).
 */
export function pickChanges<T>(
  input: Record<string, unknown>,
  parsers: { [K in keyof T]?: (value: unknown) => T[K] },
): Partial<T> {
  const changes: Partial<T> = {};
  for (const key of Object.keys(parsers) as (keyof T & string)[]) {
    if (key in input) changes[key] = parsers[key]!(input[key]);
  }
  return changes;
}

/** The next free `position` among the rows `where` selects, computed in the insert. */
/** The sum of the selected lines' amounts, each rounded as `amountCents` does. */
export const linesTotalSql = () =>
  sql<string>`coalesce(sum(round(${budgetLines.quantityMilli}::numeric * ${budgetLines.unitPriceCents} / 1000)), 0)`;

/**
 * The same at the client's price, as `priceLines` (obra-calc.ts): each unit
 * price with its revision's margins in, to the cent. Lines joined to their
 * revision; chapters only (never negative, so SQL and JS round alike).
 */
export const linesPriceSql = () =>
  sql<string>`coalesce(sum(round(${budgetLines.quantityMilli}::numeric * round(${budgetLines.unitPriceCents}::numeric * (10000 + ${budgetRevisions.overheadBp} + ${budgetRevisions.profitBp}) / 10000) / 1000)), 0)`;

export function nextPosition(table: PgTable, position: AnyColumn, where: SQL | undefined) {
  return sql<number>`(select coalesce(max(${position}), -1) + 1 from ${table} where ${where})`;
}

// ─── Budget ──────────────────────────────────────────────────────────────────

export type RevisionRow = typeof budgetRevisions.$inferSelect;
type LineRow = typeof budgetLines.$inferSelect;

function toBudgetLine(row: LineRow): BudgetLine {
  return {
    id: row.id,
    code: row.code,
    description: row.description,
    unit: row.unit,
    quantity: row.quantityMilli / 1000,
    unitPriceCents: row.unitPriceCents,
    amountCents: amountCents(row.quantityMilli, row.unitPriceCents),
    executedPct: row.executedPct,
    source: row.source,
    lineageId: row.lineageId,
    baseCode: row.baseCode,
    note: row.note,
  };
}

/** A chapter (or option) with its lines and their progress. */
export type LoadedChapter = {
  id: string;
  code: string;
  name: string;
  changeNote: string | null;
  pdfNote: string | null;
  kind: "chapter" | "option";
  optionKind: OptionKind | null;
  replacesLine: string | null;
  chosen: boolean | null;
  lines: BudgetLine[];
} & Progress;

/** What the contract includes: the chapters, and the options the client chose. */
export const inContract = (c: LoadedChapter) => c.kind === "chapter" || c.chosen === true;

/** A revision's chapters, then its options, in order, each with its lines and progress. */
export async function loadChapters(revisionId: string): Promise<LoadedChapter[]> {
  const rows = await db
    .select({ chapter: budgetChapters, line: budgetLines })
    .from(budgetChapters)
    .leftJoin(budgetLines, eq(budgetLines.chapterId, budgetChapters.id))
    .where(eq(budgetChapters.revisionId, revisionId))
    .orderBy(asc(budgetChapters.kind), asc(budgetChapters.position), asc(budgetLines.position));

  const chapters = new Map<string, { row: typeof budgetChapters.$inferSelect; lines: BudgetLine[] }>();
  for (const { chapter, line } of rows) {
    const entry = chapters.get(chapter.id) ?? { row: chapter, lines: [] };
    if (line) entry.lines.push(toBudgetLine(line));
    chapters.set(chapter.id, entry);
  }
  return [...chapters.values()].map(({ row, lines }) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    changeNote: row.changeNote,
    pdfNote: row.pdfNote,
    kind: row.kind,
    optionKind: row.optionKind,
    replacesLine: row.replacesLine,
    chosen: row.chosen,
    lines,
    ...progressOf(lines),
  }));
}

/** Chapters and options at the client's price: their lines priced, progress with them. */
function priceChapters(loaded: LoadedChapter[], margins: Margins): LoadedChapter[] {
  return loaded.map((c) => {
    const lines = priceLines(c.lines, margins);
    return { ...c, lines, ...progressOf(lines) };
  });
}

/**
 * The accepted revision (the contract) with its chapters at the client's
 * price: what the works, the hitos' prices and the client's app follow.
 * Drafts only show on the Budget.
 */
export async function loadBudget(tenantId: string, projectId: string) {
  const revision =
    (await db.query.budgetRevisions.findFirst({
      where: and(
        eq(budgetRevisions.projectId, projectId),
        eq(budgetRevisions.tenantId, tenantId),
        eq(budgetRevisions.status, "accepted"),
      ),
    })) ?? null;
  // The works follow the contract: chapters plus the options the client chose.
  // A FRAMER budget has all twenty chapters; those without lines aren't built.
  const costChapters = revision ? (await loadChapters(revision.id)).filter((c) => inContract(c) && c.lines.length > 0) : [];
  const chapters = revision ? priceChapters(costChapters, revision) : [];
  return { revision, chapters, costChapters, progress: progressOf(chapters.flatMap((c) => c.lines)) };
}

// ─── Hitos ───────────────────────────────────────────────────────────────────

export type HitoRow = typeof obraHitos.$inferSelect;

export function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const group = groups.get(key(row));
    if (group) group.push(row);
    else groups.set(key(row), [row]);
  }
  return groups;
}

/** The project's hito rows and everything hanging off them, grouped by hito. */
async function loadHitoRows(tenantId: string, projectId: string) {
  const inProject = and(eq(obraHitos.projectId, projectId), eq(obraHitos.tenantId, tenantId));
  const [rows, codes, checks, photos, requests] = await Promise.all([
    db.select().from(obraHitos).where(inProject).orderBy(asc(obraHitos.position)),
    db
      .select()
      .from(obraHitoChapters)
      .where(
        and(eq(obraHitoChapters.projectId, projectId), eq(obraHitoChapters.tenantId, tenantId)),
      ),
    db
      .select({ check: obraHitoChecks })
      .from(obraHitoChecks)
      .innerJoin(obraHitos, eq(obraHitos.id, obraHitoChecks.hitoId))
      .where(inProject)
      .orderBy(asc(obraHitoChecks.position)),
    db
      .select({ hitoId: obraHitoPhotos.hitoId, photoId: obraHitoPhotos.photoId })
      .from(obraHitoPhotos)
      .innerJoin(obraHitos, eq(obraHitos.id, obraHitoPhotos.hitoId))
      .where(inProject),
    db
      .select({ request: obraInvoiceRequests, by: users.name, byEmail: users.email })
      .from(obraInvoiceRequests)
      .leftJoin(users, eq(users.id, obraInvoiceRequests.requestedById))
      .where(and(eq(obraInvoiceRequests.projectId, projectId), eq(obraInvoiceRequests.tenantId, tenantId))),
  ]);
  return {
    requests: requests.map(({ request, by, byEmail }) => ({ ...request, requestedBy: by ?? byEmail })),
    rows,
    codes: groupBy(codes, (c) => c.hitoId),
    checks: groupBy(
      checks.map((c) => c.check),
      (c) => c.hitoId,
    ),
    photos: groupBy(photos, (p) => p.hitoId),
  };
}

type HitoRows = Awaited<ReturnType<typeof loadHitoRows>>;

/** Hitos priced from `totalCents`, following their chapters' progress. */
function toHitos(
  { rows, codes, checks, photos, requests }: HitoRows,
  chapters: LoadedChapter[],
  totalCents: number,
  vatRateBp: number,
): Hito[] {
  return rows.map((row) => {
    const mapped = new Set((codes.get(row.id) ?? []).map((c) => c.chapterCode));
    // In budget order; codes the budget doesn't have are left out.
    const own = chapters.filter((c) => mapped.has(c.code));
    const ownChecks = (checks.get(row.id) ?? []).map(({ id, label, done }) => ({ id, label, done }));
    const readyPct = progressOf(own.flatMap((c) => c.lines)).progressPct;
    const dueFrom = row.actaSignedOn ?? row.invoicedOn;
    const hitoAmount = ofBp(totalCents, row.pctBp);
    const vatCents = ofBp(hitoAmount, vatRateBp);
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      pctBp: row.pctBp,
      amountCents: hitoAmount,
      vatCents,
      totalCents: hitoAmount + vatCents,
      scope: row.scope,
      billingMoment: row.billingMoment,
      status: hitoStatus({ ...row, chapterCount: own.length, readyPct, checks: ownChecks }),
      readyPct,
      chapters: own.map(({ code, name, totalCents: total, progressPct }) => ({
        code,
        name,
        totalCents: total,
        progressPct,
      })),
      checks: ownChecks,
      photoIds: (photos.get(row.id) ?? []).map((p) => p.photoId),
      actaSignedOn: row.actaSignedOn,
      invoicedOn: row.invoicedOn,
      dueOn: dueFrom ? paymentDueOn(dueFrom) : null,
      paidOn: row.paidOn,
      paidAmountCents: row.paidAmountCents,
      invoiceRequestedAt: requests.find((r) => r.hitoId === row.id)?.requestedAt.toISOString() ?? null,
    };
  });
}

/** The chapters' actual dates recorded on the Obra tab (construction control). */
export async function loadProgressRows(tenantId: string, projectId: string) {
  return db
    .select()
    .from(obraChapterProgress)
    .where(and(eq(obraChapterProgress.projectId, projectId), eq(obraChapterProgress.tenantId, tenantId)));
}

/**
 * The project's accepted budget and hitos, computed. A chapter recorded as
 * finished on the Obra tab counts as built in full, whatever its lines' %:
 * the hitos and the client's app follow it.
 */
export async function loadObra(tenantId: string, projectId: string) {
  const [budget, hitoRows, progressRows] = await Promise.all([
    loadBudget(tenantId, projectId),
    loadHitoRows(tenantId, projectId),
    loadProgressRows(tenantId, projectId),
  ]);
  const { revision, costChapters } = budget;
  let { chapters, progress } = budget;
  const finished = new Set(progressRows.filter((r) => r.actualEnd).map((r) => r.chapterCode));
  if (finished.size > 0) {
    chapters = chapters.map((c) => {
      if (!finished.has(c.code)) return c;
      const lines = c.lines.map((line) => ({ ...line, executedPct: 100 }));
      return { ...c, lines, ...progressOf(lines) };
    });
    progress = progressOf(chapters.flatMap((c) => c.lines));
  }
  const vatRateBp = revision?.vatRateBp ?? 1000;
  const hitos = toHitos(hitoRows, chapters, progress.totalCents, vatRateBp);
  return { revision, chapters, costChapters, progress, vatRateBp, hitos, progressRows, requests: hitoRows.requests };
}
