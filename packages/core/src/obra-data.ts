import {
  and,
  asc,
  budgetChapters,
  budgetLines,
  budgetRevisions,
  db,
  eq,
  inArray,
  isNull,
  obraHitoChapters,
  obraHitoChecks,
  obraHitoPhotos,
  obraHitos,
  users,
  obraChapterProgress,
  obraInvoiceRequests,
  projectPhotos,
  sql,
  type AnyColumn,
  type PgTable,
  type SQL,
} from "@repo/db";
import {
  amountCents,
  type BudgetLine,
  type OptionKind,
  type Hito,
  type ObraError,
  type ObraStage,
} from "./contract";
import { CoreError } from "./errors";
import {
  addTotals,
  allDone,
  hitoStatus,
  NO_LINES,
  ofBp,
  paymentDueOn,
  priceLines,
  progressOf,
  progressOfTotals,
  type LineTotals,
  type Margins,
  type Progress,
} from "./obra-calc";
import { requireProject as requireProjectRow } from "./project-files";
import { approvedPlansOf, planDatesOf } from "./planning-data";

// ─── Obra: shared loading and checks ─────────────────────────────────────────
// What the budget, hitos and obra services share: errors, and loading a
// project's current budget and hitos into their computed shapes.
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
  has_invoices: 409,
  has_payments: 409,
  duplicate_number: 409,
  milestones_mismatch: 400,
  milestones_cut: 409,
  exceeds_amount: 409,
  request_not_approved: 409,
  no_changes: 400,
  below_invoiced: 409,
  budget_exists: 409,
  draft_exists: 409,
  not_draft: 409,
  not_accepted: 409,
  no_budget: 404,
  project_not_found: 404,
  idempotency_key_reused: 409,
  exclusion_exists: 409,
  exclusion_library_full: 409,
  too_many_exclusions: 409,
  not_found: 404,
  forbidden: 403,
};

export function fail(code: ObraError): never {
  throw new CoreError(code, STATUS[code]);
}

// Project lookup is the same as for the project's files.
export const requireProject = requireProjectRow;
export type ObraProject = Awaited<ReturnType<typeof requireProjectRow>>;

export const asStage = (stage: number) => stage as ObraStage;

/** Who did something: their name, else their email. */
export const userName = sql<string | null>`coalesce(${users.name}, ${users.email})`;

/** The tenant's users among `ids`: their name, or their email without one. */
export async function userNamesById(tenantId: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, name: userName })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), inArray(users.id, unique)));
  return new Map(rows.map((u) => [u.id, u.name ?? ""]));
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
/** The sum of the selected lines' amounts, each rounded as `amountCents` does. */
export const linesTotalSql = () =>
  sql<number>`coalesce(sum(round(${budgetLines.quantityMilli}::numeric * ${budgetLines.unitPriceCents} / 1000)), 0)`.mapWith(Number);

/**
 * One line's amount at the client's price, as `priceLines` (obra-calc.ts): its
 * unit price with its revision's margins in, to the cent (`roundHalfAway`, as
 * SQL's `round`), times its quantity, rounded as `amountCents` (`Math.round`:
 * floor(x + 0.5), which differs from `round` only on a negative .5, an
 * option's deduction). Lines joined to their revision.
 */
export const linePriceSql = () =>
  sql<string>`floor(${budgetLines.quantityMilli}::numeric * round(${budgetLines.unitPriceCents}::numeric * 10000 / (10000 - ${budgetRevisions.overheadBp} - ${budgetRevisions.profitBp})) / 1000 + 0.5)`;

/** The sum of the selected lines' `linePriceSql`. */
export const linesPriceSql = () => sql<number>`coalesce(sum(${linePriceSql()}), 0)`.mapWith(Number);

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
  return (await loadChaptersOf([revisionId])).get(revisionId) ?? [];
}

/** `loadChapters` for several revisions at once, by revision id. */
async function loadChaptersOf(revisionIds: string[]): Promise<Map<string, LoadedChapter[]>> {
  if (revisionIds.length === 0) return new Map();
  const rows = await db
    .select({ chapter: budgetChapters, line: budgetLines })
    .from(budgetChapters)
    .leftJoin(budgetLines, eq(budgetLines.chapterId, budgetChapters.id))
    .where(inArray(budgetChapters.revisionId, revisionIds))
    .orderBy(asc(budgetChapters.kind), asc(budgetChapters.position), asc(budgetLines.position));

  const chapters = new Map<string, { row: typeof budgetChapters.$inferSelect; lines: BudgetLine[] }>();
  for (const { chapter, line } of rows) {
    const entry = chapters.get(chapter.id) ?? { row: chapter, lines: [] };
    if (line) entry.lines.push(toBudgetLine(line));
    chapters.set(chapter.id, entry);
  }
  const byRevision = groupBy([...chapters.values()], (c) => c.row.revisionId);
  return new Map([...byRevision].map(([id, list]) => [id, list.map(toLoadedChapter)]));
}

function toLoadedChapter({ row, lines }: { row: typeof budgetChapters.$inferSelect; lines: BudgetLine[] }): LoadedChapter {
  return {
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
  };
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
  return (await loadBudgets(tenantId, [projectId])).get(projectId)!;
}

/** `loadBudget` for several projects at once, by project id. */
async function loadBudgets(tenantId: string, projectIds: string[]) {
  const revisions = await db
    .select()
    .from(budgetRevisions)
    .where(
      and(
        inArray(budgetRevisions.projectId, projectIds),
        eq(budgetRevisions.tenantId, tenantId),
        eq(budgetRevisions.status, "accepted"),
      ),
    );
  const revisionOf = new Map(revisions.map((r) => [r.projectId, r]));
  const loaded = await loadChaptersOf(revisions.map((r) => r.id));
  return new Map(
    projectIds.map((projectId) => {
      const revision = revisionOf.get(projectId) ?? null;
      // The works follow the contract: chapters plus the options the client chose.
      // A FRAMER budget has all twenty chapters; those without lines aren't built.
      const costChapters = revision ? (loaded.get(revision.id) ?? []).filter((c) => inContract(c) && c.lines.length > 0) : [];
      const chapters = revision ? priceChapters(costChapters, revision) : [];
      return [projectId, { revision, chapters, costChapters, progress: progressOf(chapters.flatMap((c) => c.lines)) }] as const;
    }),
  );
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

/**
 * The projects' hito rows and everything hanging off them, grouped by hito
 * (hitos and requests by project). Without `acta`, no checks nor photos: the
 * project list reads neither.
 */
async function loadHitoRows(tenantId: string, projectIds: string[], { acta = true } = {}) {
  const inProject = and(inArray(obraHitos.projectId, projectIds), eq(obraHitos.tenantId, tenantId));
  const [rows, codes, checks, photos, requests] = await Promise.all([
    db.select().from(obraHitos).where(inProject).orderBy(asc(obraHitos.position)),
    db
      .select()
      .from(obraHitoChapters)
      .where(
        and(inArray(obraHitoChapters.projectId, projectIds), eq(obraHitoChapters.tenantId, tenantId)),
      ),
    acta
      ? db
          .select({ check: obraHitoChecks })
          .from(obraHitoChecks)
          .innerJoin(obraHitos, eq(obraHitos.id, obraHitoChecks.hitoId))
          .where(inProject)
          .orderBy(asc(obraHitoChecks.position))
      : [],
    // A deleted photo is out of the acta too.
    acta
      ? db
          .select({ hitoId: obraHitoPhotos.hitoId, photoId: obraHitoPhotos.photoId })
          .from(obraHitoPhotos)
          .innerJoin(obraHitos, eq(obraHitos.id, obraHitoPhotos.hitoId))
          .innerJoin(projectPhotos, and(eq(projectPhotos.id, obraHitoPhotos.photoId), isNull(projectPhotos.deletedAt)))
          .where(inProject)
      : [],
    db
      .select({ request: obraInvoiceRequests, by: users.name, byEmail: users.email })
      .from(obraInvoiceRequests)
      .leftJoin(users, eq(users.id, obraInvoiceRequests.requestedById))
      .where(and(inArray(obraInvoiceRequests.projectId, projectIds), eq(obraInvoiceRequests.tenantId, tenantId))),
  ]);
  return {
    requestsOf: groupBy(
      requests.map(({ request, by, byEmail }) => ({ ...request, requestedBy: by ?? byEmail })),
      (r) => r.projectId,
    ),
    rowsOf: groupBy(rows, (r) => r.projectId),
    codes: groupBy(codes, (c) => c.hitoId),
    checks: groupBy(
      checks.map((c) => c.check),
      (c) => c.hitoId,
    ),
    photos: groupBy(photos, (p) => p.hitoId),
  };
}

type AllHitoRows = Awaited<ReturnType<typeof loadHitoRows>>;

/** One project's share of `loadHitoRows`: its hitos and requests (the rest is keyed by hito). */
const hitoRowsOf = ({ rowsOf, requestsOf, ...byHito }: AllHitoRows, projectId: string) => ({
  ...byHito,
  rows: rowsOf.get(projectId) ?? [],
  requests: requestsOf.get(projectId) ?? [],
});

type HitoRows = ReturnType<typeof hitoRowsOf>;

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
export async function loadProgressRows(tenantId: string, projectId: string | string[]) {
  return db
    .select()
    .from(obraChapterProgress)
    .where(and(inArray(obraChapterProgress.projectId, [projectId].flat()), eq(obraChapterProgress.tenantId, tenantId)));
}

/**
 * The project's accepted budget and hitos, computed, with the Planning
 * baseline's dates (null without one). A chapter recorded as
 * finished on the Obra tab counts as built in full, whatever its lines' %:
 * the hitos and the client's app follow it.
 */
export async function loadObra(tenantId: string, projectId: string) {
  return (await loadObras(tenantId, [projectId])).get(projectId)!;
}

export type LoadedObra = Awaited<ReturnType<typeof loadObra>>;

/** `loadObra` for several projects at once, in the same few queries as one. */
async function loadObras(tenantId: string, projectIds: string[]) {
  const [budgets, allHitoRows, allProgressRows, plans] = await Promise.all([
    loadBudgets(tenantId, projectIds),
    loadHitoRows(tenantId, projectIds),
    loadProgressRows(tenantId, projectIds),
    approvedPlansOf(tenantId, projectIds),
  ]);
  const progressOfProject = groupBy(allProgressRows, (r) => r.projectId);
  return new Map(
    projectIds.map((projectId) => {
      const budget = budgets.get(projectId)!;
      const hitoRows = hitoRowsOf(allHitoRows, projectId);
      const progressRows = progressOfProject.get(projectId) ?? [];
      // The approved baseline, read once: its dates here, its rules for the schedule's forecast (./planning).
      const plan = plans.get(projectId) ?? null;
      const planDates = planDatesOf(plan);
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
      const obra = { revision, chapters, costChapters, progress, vatRateBp, hitos, progressRows, plan, planDates, requests: hitoRows.requests };
      return [projectId, obra] as const;
    }),
  );
}

// ─── The project list's obras ────────────────────────────────────────────────
// What the Proyectos list reads of every obra (./project-signals): the built
// %, the hitos' states and the schedule. Not the lines: each chapter's
// `LineTotals` summed in SQL, priced as `priceChapters` prices them, so the
// same `progressOfTotals` gives the figure `loadObra`'s lines give.

/** A hito as the list reads it: its share, its chapters in the contract (in budget order) and its invoice. */
export type HitoSummary = Pick<Hito, "id" | "pctBp" | "invoicedOn" | "paidOn" | "dueOn"> & { chapters: { code: string }[] };

/** Each accepted budget's contract chapters (with lines) and their lines' totals at the client's price. */
async function contractTotalsOf(tenantId: string, projectIds: string[]) {
  const l = budgetLines;
  const rows = await db.execute<{
    project_id: string;
    revision_id: string;
    code: string | null;
    name: string | null;
    lines: number;
    works_lines: number;
    works_done: number;
    works_started: number;
    works_cents: string;
    works_executed_cents: string;
    deducted_cents: string;
  }>(sql`
    with priced as materialized (
      select ${budgetRevisions.projectId} as project_id, ${budgetRevisions.id} as revision_id,
        ${budgetChapters.id} as chapter_id, ${budgetChapters.code} as code, ${budgetChapters.name} as name,
        ${budgetChapters.kind} as kind, ${budgetChapters.position} as position,
        ${l.id} as line_id, ${l.executedPct} as executed_pct, ${linePriceSql()}::bigint as amount
      from ${budgetRevisions}
      left join (${budgetChapters} join ${budgetLines} on ${l.chapterId} = ${budgetChapters.id})
        on ${budgetChapters.revisionId} = ${budgetRevisions.id}
        and (${budgetChapters.kind} = 'chapter' or ${budgetChapters.chosen} = true)
      where ${budgetRevisions.tenantId} = ${tenantId}
        and ${inArray(budgetRevisions.projectId, projectIds)}
        and ${budgetRevisions.status} = 'accepted'
    )
    select project_id, revision_id, code, name,
      count(line_id)::int as lines,
      (count(*) filter (where amount >= 0))::int as works_lines,
      (count(*) filter (where amount >= 0 and executed_pct = 100))::int as works_done,
      (count(*) filter (where amount >= 0 and executed_pct > 0))::int as works_started,
      coalesce(sum(amount) filter (where amount >= 0), 0)::bigint as works_cents,
      -- Math.round(amount × % / 100), on amounts ≥ 0.
      coalesce(sum((amount * executed_pct + 50) / 100) filter (where amount >= 0), 0)::bigint as works_executed_cents,
      coalesce(sum(amount) filter (where amount < 0), 0)::bigint as deducted_cents
    from priced
    group by project_id, revision_id, chapter_id, code, name, kind, position
    order by kind, position`);
  const byProject = new Map<string, { revisionId: string; chapters: { code: string; name: string; totals: LineTotals }[] }>();
  for (const row of rows) {
    const contract = byProject.get(row.project_id) ?? { revisionId: row.revision_id, chapters: [] };
    byProject.set(row.project_id, contract);
    // One accepted revision at most; a revision whose contract has no lines yet has a row with no chapter.
    if (contract.revisionId !== row.revision_id || row.code === null) continue;
    contract.chapters.push({
      code: row.code,
      name: row.name!,
      totals: {
        lines: row.lines,
        worksLines: row.works_lines,
        worksDone: row.works_done,
        worksStarted: row.works_started,
        worksCents: Number(row.works_cents),
        worksExecutedCents: Number(row.works_executed_cents),
        deductedCents: Number(row.deducted_cents),
      },
    });
  }
  return byProject;
}

/**
 * `loadObras` for the project list: whether there is a contract, its chapters
 * (code and name), the built %, the hitos, Avance's rows and the approved
 * baseline, with what `loadObra` gives for each; no lines, no hito checks or
 * photos, no figure per chapter.
 */
export async function loadObraSummaries(tenantId: string, projectIds: string[]) {
  const [contracts, allHitoRows, allProgressRows, plans] = await Promise.all([
    contractTotalsOf(tenantId, projectIds),
    loadHitoRows(tenantId, projectIds, { acta: false }),
    loadProgressRows(tenantId, projectIds),
    approvedPlansOf(tenantId, projectIds),
  ]);
  const progressOfProject = groupBy(allProgressRows, (r) => r.projectId);
  return new Map(
    projectIds.map((projectId) => {
      const contract = contracts.get(projectId);
      const { rows, codes, requests } = hitoRowsOf(allHitoRows, projectId);
      const progressRows = progressOfProject.get(projectId) ?? [];
      const plan = plans.get(projectId) ?? null;
      const costChapters = contract?.chapters ?? [];
      // As `loadObra`: a chapter recorded as finished counts as built in full.
      const finished = new Set(progressRows.filter((r) => r.actualEnd).map((r) => r.chapterCode));
      const totals = costChapters.reduce((sum, c) => addTotals(sum, finished.has(c.code) ? allDone(c.totals) : c.totals), NO_LINES);
      // As `toHitos`: its chapters in the contract, in budget order.
      const hitos: HitoSummary[] = rows.map((row) => {
        const mapped = new Set((codes.get(row.id) ?? []).map((c) => c.chapterCode));
        const dueFrom = row.actaSignedOn ?? row.invoicedOn;
        return {
          id: row.id,
          pctBp: row.pctBp,
          chapters: costChapters.filter((c) => mapped.has(c.code)).map(({ code }) => ({ code })),
          invoicedOn: row.invoicedOn,
          paidOn: row.paidOn,
          dueOn: dueFrom ? paymentDueOn(dueFrom) : null,
        };
      });
      const obra = {
        contracted: contract !== undefined,
        costChapters: costChapters.map(({ code, name }) => ({ code, name })),
        progress: progressOfTotals(totals),
        hitos,
        progressRows,
        plan,
        planDates: planDatesOf(plan),
        requests,
      };
      return [projectId, obra] as const;
    }),
  );
}

export type ObraSummary = NonNullable<ReturnType<Awaited<ReturnType<typeof loadObraSummaries>>["get"]>>;
