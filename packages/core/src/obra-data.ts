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
  sql,
  type AnyColumn,
  type PgTable,
  type SQL,
} from "@repo/db";
import { isCalendarDate } from "./calendar";
import {
  amountCents,
  type BudgetLine,
  type Hito,
  type ObraError,
  type ObraStage,
} from "./contract";
import { CoreError } from "./errors";
import { hitoStatus, ofBp, paymentDueOn, progressOf, type Progress } from "./obra-calc";
import { requireProject as requireProjectRow } from "./project-files";
import { clientProjectWhere } from "./project-client";

// ─── Obra: shared loading and checks ─────────────────────────────────────────
// What the budget, hitos and obra services share: errors, input parsing, and
// loading a project's current budget and hitos into their computed shapes.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS: Record<ObraError, number> = {
  missing_fields: 400,
  invalid_input: 400,
  invalid_stage: 400,
  invalid_date: 400,
  missing_file: 400,
  invalid_file_type: 400,
  file_too_large: 413,
  duplicate_code: 409,
  unknown_chapter: 400,
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

// Who may edit (admins and managers) and project lookup are the same as for
// the project's files.
export { requireFileManager as requireEditor } from "./project-files";

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
  };
}

/** A chapter with its lines and their progress. */
export type LoadedChapter = {
  id: string;
  code: string;
  name: string;
  changeNote: string | null;
  lines: BudgetLine[];
} & Progress;

/** A revision's chapters in order, each with its lines and progress. */
export async function loadChapters(revisionId: string): Promise<LoadedChapter[]> {
  const rows = await db
    .select({ chapter: budgetChapters, line: budgetLines })
    .from(budgetChapters)
    .leftJoin(budgetLines, eq(budgetLines.chapterId, budgetChapters.id))
    .where(eq(budgetChapters.revisionId, revisionId))
    .orderBy(asc(budgetChapters.position), asc(budgetLines.position));

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
    lines,
    ...progressOf(lines),
  }));
}

/**
 * The accepted revision (the contract) with its chapters: what the works, the
 * hitos' prices and the client's app follow. Drafts only show on the Budget.
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
  const chapters = revision ? await loadChapters(revision.id) : [];
  return { revision, chapters, progress: progressOf(chapters.flatMap((c) => c.lines)) };
}

// ─── Hitos ───────────────────────────────────────────────────────────────────

export type HitoRow = typeof obraHitos.$inferSelect;

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
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
  const [rows, codes, checks, photos] = await Promise.all([
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
  ]);
  return {
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
  { rows, codes, checks, photos }: HitoRows,
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
    };
  });
}

/** The project's accepted budget and hitos, computed. */
export async function loadObra(tenantId: string, projectId: string) {
  const [{ revision, chapters, progress }, hitoRows] = await Promise.all([
    loadBudget(tenantId, projectId),
    loadHitoRows(tenantId, projectId),
  ]);
  const vatRateBp = revision?.vatRateBp ?? 1000;
  const hitos = toHitos(hitoRows, chapters, progress.totalCents, vatRateBp);
  return { revision, chapters, progress, vatRateBp, hitos };
}
