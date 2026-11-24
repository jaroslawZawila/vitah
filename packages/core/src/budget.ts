import {
  and,
  budgetChapters,
  budgetLines,
  budgetRevisions,
  db,
  desc,
  eq,
  inArray,
  isNull,
  ne,
  obraHitoChapters,
  obraHitos,
  projectDocuments,
  sql,
} from "@repo/db";
import { isUniqueViolation } from "./accounts";
import {
  defaultConditions,
  defaultTexts,
  readConditions,
  readTexts,
  TEMPLATE_CHAPTERS,
} from "./budget-template";
import {
  chapterInProject,
  chosenOptions,
  draftLine,
  inDraft,
  linesInProject,
  lockForFirstBudget,
  lockProject,
  nextLineCode,
  revisionInProject,
  syncDraft,
} from "./budget-draft";
import { approvalAsProof, lapseApprovals, lockProjectRow, revisionApprovals } from "./budget-approvals";
import { compareIdentity, projectIdentity, withProjectIdentity } from "./budget-identity";
import { computeChecks, reviewedKeys, tenantRatios } from "./budget-review";
import { markChanged } from "./changes";
import { raiseStage } from "./obra-stage";
import { requireEditor, type Ctx } from "./context";
import { CoreError } from "./errors";
import {
  BUDGET_MODEL,
  CONTINGENCY_CHAPTER,
  DEFAULT_MARGINS,
  type BudgetChapter,
  type BudgetCheck,
  type BudgetLineChange,
  type BudgetOption,
  type BudgetPdfKind,
  type BudgetQuality,
  type BudgetRevision,
  type BudgetRevisionSummary,
  type BudgetTexts,
  type ChapterChange,
  type ProjectBudget,
  withExclusion,
} from "./contract";
import { addToLibrary, libraryOf } from "./budget-exclusions";
import { getLatestGeneration } from "./budget-generations";
import { createDefaultHitos } from "./hitos";
import {
  acceptSchema,
  chapterChangesSchema,
  lineBaseSchema,
  lineChangesSchemas,
  MAX_EXCLUSIONS,
  MAX_REVIEWED,
  newBudgetSchema,
  newChapterSchema,
  newLineSchemas,
  numberedLineSchemas,
  progressSchema,
  rejectSchema,
  revisionChangesSchema,
  type TextsChanges,
} from "./inputs/budget";
import { changesOf, parse } from "./inputs/fields";
import type { Tx } from "./project-client";
import { marginsOn, ofBp, perM2Cents, shareBp, todayInSpain, withPrices } from "./obra-calc";
import {
  fail,
  linesPriceSql,
  loadChapters,
  nextPosition,
  requireProject,
  userNamesById,
  type LoadedChapter,
  type RevisionRow,
} from "./obra-data";
import { priceBaseItem } from "./price-base";
import { newPdfDocument, requirePdf } from "./documents";
import { notifyProjectClient } from "./notifications";
import { storeFiles } from "./project-files";

// ─── Budget ──────────────────────────────────────────────────────────────────
// A project's budget in the FRAMER model (features/budget/TECH_DESIGN.md): the
// twenty fixed chapters, options priced apart below them, and revisions. A
// draft is edited freely; issuing it freezes it (with its PDFs, budget-issue.ts);
// the client then accepts it (it becomes the contract) or rejects it. A change
// is a new revision copied from the newest. From the contract on, staff only
// record each line's executed %. The client's app sees only the contract, so
// drafts never mark the obra changed.
//
// Budgets entered before the FRAMER model (`model` null) keep free chapters.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Reading ─────────────────────────────────────────────────────────────────

/** Each revision's PEC (chapters only, never options, at the client's price). */
async function revisionTotals(projectId: string) {
  const rows = await db
    .select({
      revisionId: budgetChapters.revisionId,
      total: linesPriceSql(),
    })
    .from(budgetLines)
    .innerJoin(budgetChapters, eq(budgetChapters.id, budgetLines.chapterId))
    .innerJoin(budgetRevisions, eq(budgetRevisions.id, budgetChapters.revisionId))
    .where(and(eq(budgetRevisions.projectId, projectId), eq(budgetChapters.kind, "chapter")))
    .groupBy(budgetChapters.revisionId);
  return new Map(rows.map((r) => [r.revisionId, r.total]));
}

/** Which hito closes each chapter (or option) code. */
async function hitoByChapter(projectId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ chapterCode: obraHitoChapters.chapterCode, hitoCode: obraHitos.code })
    .from(obraHitoChapters)
    .innerJoin(obraHitos, eq(obraHitos.id, obraHitoChapters.hitoId))
    .where(eq(obraHitoChapters.projectId, projectId));
  return new Map(rows.map((r) => [r.chapterCode, r.hitoCode]));
}

function change(current: number, previous: number | undefined): ChapterChange {
  if (previous === undefined) return "new";
  if (current > previous) return "up";
  if (current < previous) return "down";
  return null;
}

/**
 * A revision's chapters as the API shows them: their total (at cost) and price
 * (`withPrices`) as a share of `totalCents`, the hito closing each, and how
 * each changed against `before` (the previous revision's chapters; null when
 * there is none).
 */
export function toBudgetChapters(
  chapters: (LoadedChapter & { priceCents: number })[],
  before: LoadedChapter[] | null,
  totalCents: number,
  hitoOf: Map<string, string>,
  { framer = false, builtAreaCm2 = null as number | null } = {},
): BudgetChapter[] {
  const previousTotals = new Map(before?.map((c) => [c.code, c.totalCents]));
  return chapters.map((chapter) => {
    const previousTotal = previousTotals.get(chapter.code);
    const { priceCents } = chapter;
    return {
      id: chapter.id,
      code: chapter.code,
      name: chapter.name,
      changeNote: chapter.changeNote,
      pdfNote: chapter.pdfNote,
      totalCents: chapter.totalCents,
      executedCents: chapter.executedCents,
      progressPct: chapter.progressPct,
      status: chapter.status,
      shareBp: shareBp(priceCents, totalCents),
      previousTotalCents: previousTotal ?? null,
      change: before ? change(chapter.totalCents, previousTotal) : null,
      hitoCode: hitoOf.get(chapter.code) ?? null,
      lines: chapter.lines,
      computed: framer && chapter.kind === "chapter" && chapter.code === CONTINGENCY_CHAPTER,
      lineCount: countLines([chapter]),
      priceCents,
      perM2Cents: perM2Cents(priceCents, builtAreaCm2),
    };
  });
}

/** Lines staff wrote (chapter 20's computed line isn't one). */
const countLines = (chapters: LoadedChapter[]) =>
  chapters.reduce((sum, c) => sum + c.lines.filter((l) => l.source !== "computed").length, 0);

/** How many options add or subtract, and by how much (at their price). */
function optionTotals(options: BudgetOption[]) {
  const side = (list: BudgetOption[]) => ({ count: list.length, cents: list.reduce((sum, o) => sum + o.priceCents, 0) });
  return { adding: side(options.filter((o) => o.priceCents > 0)), subtracting: side(options.filter((o) => o.priceCents < 0)) };
}

function toOptions(
  options: (LoadedChapter & { priceCents: number })[],
  before: LoadedChapter[] | null,
  hitoOf: Map<string, string>,
  view: { framer: boolean; builtAreaCm2: number | null },
): BudgetOption[] {
  return toBudgetChapters(options, before, 0, hitoOf, view).map(({ shareBp: _, ...option }, i) => ({
    ...option,
    optionKind: options[i]!.optionKind ?? "extra",
    replacesLine: options[i]!.replacesLine,
    chosen: options[i]!.chosen,
  }));
}

export function toSummary(row: RevisionRow, totalCents: number): BudgetRevisionSummary {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    totalCents,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    issuedOn: row.issuedOn,
  };
}

/** Lines added, removed or changed between two revisions, matched by lineage (codes may be renumbered). */
export function lineChanges(chapters: LoadedChapter[], before: LoadedChapter[]): BudgetLineChange[] {
  const figures = (l: LoadedChapter["lines"][number]) => ({
    quantity: l.quantity,
    unitPriceCents: l.unitPriceCents,
    amountCents: l.amountCents,
  });
  const index = (list: LoadedChapter[]) =>
    new Map(
      list.flatMap((c) =>
        c.lines.filter((l) => l.source !== "computed").map((l) => [l.lineageId, l] as const),
      ),
    );
  const now = index(chapters);
  const then = index(before);
  const changes: BudgetLineChange[] = [];
  for (const [key, line] of now) {
    const old = then.get(key);
    if (!old) changes.push({ code: line.code, description: line.description, kind: "added", before: null, after: figures(line) });
    else if (old.quantity !== line.quantity || old.unitPriceCents !== line.unitPriceCents) {
      changes.push({ code: line.code, description: line.description, kind: "changed", before: figures(old), after: figures(line) });
    }
  }
  for (const [key, line] of then) {
    if (!now.has(key)) changes.push({ code: line.code, description: line.description, kind: "removed", before: figures(line), after: null });
  }
  return changes;
}

/** The PDFs stored when each revision was issued. */
async function revisionPdfs(revisionId: string): Promise<Record<BudgetPdfKind, string | null>> {
  const rows = await db
    .select({ id: projectDocuments.id, kind: projectDocuments.budgetPdf })
    .from(projectDocuments)
    .where(and(eq(projectDocuments.budgetRevisionId, revisionId), isNull(projectDocuments.deletedAt)));
  const of = (kind: BudgetPdfKind) => rows.find((r) => r.kind === kind)?.id ?? null;
  return { general: of("general"), detailed: of("detailed") };
}

const lines = (text: string | null) =>
  (text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

/** A revision in full, compared with the one before it. */
export async function revisionView(
  row: RevisionRow,
  previous: RevisionRow | undefined,
  totals: Map<string, number>,
): Promise<BudgetRevision> {
  const [loaded, before, hitoOf, pdfs, ratios, names, project, consent] = await Promise.all([
    loadChapters(row.id),
    previous ? loadChapters(previous.id) : null,
    hitoByChapter(row.projectId),
    revisionPdfs(row.id),
    row.model === BUDGET_MODEL ? tenantRatios(row.tenantId, row.projectId) : {},
    userNamesById(row.tenantId, [row.acceptedByUserId]),
    row.model === BUDGET_MODEL ? projectIdentity(row.tenantId, row.projectId) : null,
    revisionApprovals(row.tenantId, row.id),
  ]);
  const registrar = row.acceptedByUserId === null ? undefined : names.get(row.acceptedByUserId);
  const priced = withPrices(loaded, row);
  const chapters = priced.filter((c) => c.kind === "chapter");
  const options = priced.filter((c) => c.kind === "option");
  const beforeChapters = before?.filter((c) => c.kind === "chapter") ?? null;
  const beforeOptions = before?.filter((c) => c.kind === "option") ?? null;
  const costCents = chapters.reduce((sum, c) => sum + c.totalCents, 0);
  const totalCents = chapters.reduce((sum, c) => sum + c.priceCents, 0);
  const codes = new Set(chapters.map((c) => c.code));
  const framer = row.model === BUDGET_MODEL;
  const texts = framer ? readTexts(row.texts) : { ...defaultTexts(), exclusions: lines(row.exclusions) };
  const view = { framer, builtAreaCm2: row.builtAreaCm2 };
  const budgetChapters = toBudgetChapters(chapters, beforeChapters, totalCents, hitoOf, view);
  const budgetOptions = toOptions(options, beforeOptions, hitoOf, view);
  const chosenCents = budgetOptions.filter((o) => o.chosen).reduce((sum, o) => sum + o.priceCents, 0);
  return {
    ...toSummary(row, totalCents),
    reference: row.reference,
    vatRateBp: row.vatRateBp,
    vatCents: ofBp(totalCents, row.vatRateBp),
    builtAreaM2: row.builtAreaCm2 === null ? null : row.builtAreaCm2 / 100,
    usefulAreaM2: row.usefulAreaCm2 === null ? null : row.usefulAreaCm2 / 100,
    exclusions: texts.exclusions,
    previous: previous ? { number: previous.number, totalCents: totals.get(previous.id) ?? 0 } : null,
    removedChapters: (beforeChapters ?? [])
      .filter((c) => !codes.has(c.code))
      .map((c) => ({ code: c.code, name: c.name, totalCents: c.totalCents })),
    chapters: budgetChapters,
    lineCount: countLines(chapters),
    perM2Cents: perM2Cents(totalCents, row.builtAreaCm2),
    costCents,
    overheadBp: row.overheadBp,
    profitBp: row.profitBp,
    ...marginsOn(costCents, totalCents, row),
    optionTotals: optionTotals(budgetOptions),
    model: row.model,
    options: budgetOptions,
    contractTotalCents: totalCents + chosenCents,
    contingencyBp: row.contingencyBp,
    quality: row.quality,
    texts,
    identity: project && compareIdentity(texts.cover, project),
    conditions: readConditions(row.conditions),
    changeReason: row.changeReason,
    validUntil: row.validUntil,
    acceptedOn: row.acceptedOn,
    acceptedBy: row.acceptedBy,
    acceptedByUser: registrar === undefined ? null : { id: row.acceptedByUserId!, name: registrar },
    signedDocumentId: row.acceptedDocumentId,
    acceptedApprovalId: row.acceptedApprovalId,
    rejectedOn: row.rejectedOn,
    changes: consent.changes,
    approvals: consent.approvals,
    pdfs,
    checks: framer
      ? computeChecks({ texts, chapters: budgetChapters, ratios, done: reviewedKeys(row.review) })
      : [],
    ratios,
    lineChanges: before ? lineChanges(loaded, before) : [],
  };
}

/**
 * A FRAMER draft's review checks, as its Budget tab works them out (`revisionView`) without the rest of it,
 * against the tenant's `ratios` for its project.
 */
export async function revisionChecks(row: RevisionRow, ratios: Record<string, number>): Promise<BudgetCheck[]> {
  const loaded = await loadChapters(row.id);
  const chapters = withPrices(loaded, row).filter((c) => c.kind === "chapter");
  const totalCents = chapters.reduce((sum, c) => sum + c.priceCents, 0);
  return computeChecks({
    texts: readTexts(row.texts),
    chapters: toBudgetChapters(chapters, null, totalCents, new Map(), { framer: true, builtAreaCm2: row.builtAreaCm2 }),
    ratios,
    done: reviewedKeys(row.review),
  });
}

/** All revisions, newest first, one of them in full (default: the newest), and the newest AI run. */
export async function getBudget(
  ctx: Ctx,
  projectId: string,
  revisionId?: string,
): Promise<ProjectBudget> {
  const [, rows, totals, generation] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    db
      .select()
      .from(budgetRevisions)
      .where(and(eq(budgetRevisions.projectId, projectId), eq(budgetRevisions.tenantId, ctx.tenantId)))
      .orderBy(desc(budgetRevisions.number)),
    revisionTotals(projectId),
    getLatestGeneration(ctx.tenantId, projectId),
  ]);
  const index = revisionId ? rows.findIndex((r) => r.id === revisionId) : 0;
  if (index === -1) fail("not_found");
  const selected = rows[index];
  return {
    revisions: rows.map((r) => toSummary(r, totals.get(r.id) ?? 0)),
    revision: selected ? await revisionView(selected, rows[index + 1], totals) : null,
    generation,
  };
}

// ─── Revisions ───────────────────────────────────────────────────────────────

type NewRevision = {
  reference: string | null;
  number: number;
  quality?: BudgetQuality | null;
  vatRateBp?: number;
  builtAreaCm2?: number | null;
  usefulAreaCm2?: number | null;
  texts?: BudgetTexts;
  generationId?: string | null;
};

/** Notes printed under chapters' titles, by code (the AI's "Sustituye a…"). */
type ChapterNotes = Map<string, string>;

/**
 * Inserts a FRAMER revision with its twenty chapters, and the standard hitos
 * if the project has none yet. Its cover names the project's client and
 * address (budget-identity.ts), over the given texts. The caller holds the
 * project lock.
 */
export async function insertFramerRevision(
  tx: Tx,
  tenantId: string,
  projectId: string,
  values: NewRevision,
  notes: ChapterNotes = new Map(),
) {
  const texts = values.texts ?? defaultTexts();
  const cover = withProjectIdentity(texts.cover, await projectIdentity(tenantId, projectId, tx));
  const [revision] = await tx
    .insert(budgetRevisions)
    .values({
      tenantId,
      projectId,
      model: BUDGET_MODEL,
      conditions: defaultConditions(),
      ...DEFAULT_MARGINS,
      ...values,
      texts: { ...texts, cover },
    })
    .returning({ id: budgetRevisions.id, contingencyBp: budgetRevisions.contingencyBp });
  const revisionId = revision!.id;
  const chapters = await tx
    .insert(budgetChapters)
    .values(
      TEMPLATE_CHAPTERS.map(({ code, name }, position) => ({ tenantId, revisionId, code, name, position, pdfNote: notes.get(code) ?? null })),
    )
    .returning({ id: budgetChapters.id, code: budgetChapters.code });
  const hito = await tx.query.obraHitos.findFirst({
    where: eq(obraHitos.projectId, projectId),
    columns: { id: true },
  });
  if (!hito) await createDefaultHitos(tx, tenantId, projectId);
  return { revisionId, contingencyBp: revision!.contingencyBp, chapterIds: new Map(chapters.map((c) => [c.code, c.id])) };
}

/**
 * Starts the project's budget: a draft (Rev.0, or `number` when an existing
 * budget is brought in at a later revision) with the twenty chapters, and the
 * standard hitos. The portal drafts budgets with the AI (budget-generations.ts);
 * this stays for /api/v1. Body: { reference?, number? }
 */
export async function createBudget(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  await requireProject(ctx.tenantId, projectId);
  const { reference, number = 0 } = parse(newBudgetSchema, input);

  const created = await db.transaction(async (tx) => {
    await lockForFirstBudget(tx, projectId);
    const { revisionId, contingencyBp } = await insertFramerRevision(tx, ctx.tenantId, projectId, { reference, number });
    await syncDraft(tx, revisionId, { tenantId: ctx.tenantId, contingencyBp });
    return { revisionId };
  });
  // The app shows the new hitos.
  await markChanged(ctx.tenantId, projectId, ["obra"]);
  await raiseStage(ctx.tenantId, projectId);
  return created;
}

/**
 * A new draft copied from the newest revision (issued, rejected or accepted),
 * progress included; its cover names the project's client and address as they
 * are now (budget-identity.ts).
 */
export async function createRevision(ctx: Ctx, projectId: string) {
  requireEditor(ctx);
  await requireProject(ctx.tenantId, projectId);

  return db.transaction(async (tx) => {
    await lockProject(tx, projectId);
    const [newest] = await tx
      .select()
      .from(budgetRevisions)
      .where(eq(budgetRevisions.projectId, projectId))
      .orderBy(desc(budgetRevisions.number))
      .limit(1);
    if (!newest) fail("no_budget");
    if (newest.status === "draft") fail("draft_exists");

    const { tenantId, reference, vatRateBp, builtAreaCm2, usefulAreaCm2, exclusions } = newest;
    const { model, contingencyBp, overheadBp, profitBp, quality } = newest;
    let { texts, conditions } = newest;
    if (model === BUDGET_MODEL) {
      const stored = readTexts(texts);
      texts = { ...stored, cover: withProjectIdentity(stored.cover, await projectIdentity(tenantId, projectId, tx)) };
      // Read, not copied as stored: a key the conditions no longer have stays behind.
      conditions = readConditions(conditions);
    }
    const [revision] = await tx
      .insert(budgetRevisions)
      .values({
        ...{ tenantId, projectId, reference, vatRateBp, builtAreaCm2, usefulAreaCm2, exclusions },
        ...{ model, contingencyBp, overheadBp, profitBp, quality, texts, conditions },
        number: newest.number + 1,
      })
      .returning({ id: budgetRevisions.id });
    const revisionId = revision!.id;

    const chapters = await tx.select().from(budgetChapters).where(eq(budgetChapters.revisionId, newest.id));
    if (chapters.length === 0) return { revisionId };
    const copied = await tx
      .select()
      .from(budgetLines)
      .where(
        inArray(
          budgetLines.chapterId,
          chapters.map((c) => c.id),
        ),
      );
    const newIds = new Map(chapters.map((c) => [c.id, crypto.randomUUID()]));
    // Notes explain changes against the revision before, and the client
    // chooses options afresh: the copy starts clean on both.
    await tx
      .insert(budgetChapters)
      .values(chapters.map((c) => ({ ...c, id: newIds.get(c.id)!, revisionId, changeNote: null, chosen: null })));
    if (copied.length > 0) {
      await tx.insert(budgetLines).values(
        copied.map(({ id: _, updatedAt: __, ...line }) => ({
          ...line,
          chapterId: newIds.get(line.chapterId)!,
        })),
      );
    }
    return { revisionId };
  });
}

/**
 * "Usar los datos del proyecto": a FRAMER draft's cover takes the project's
 * client and address where it doesn't already name them (`identity.differs`);
 * what names them, saying more, stays. Drafts only (`not_draft`): an issued
 * revision was given to the client. Answers the fields it changed.
 */
export async function takeProjectData(ctx: Ctx, projectId: string, revisionId: string) {
  const revision = await revisionInProject(ctx, projectId, revisionId);
  if (revision.model !== BUDGET_MODEL) fail("invalid_input");
  const identity = await projectIdentity(ctx.tenantId, projectId);
  const changed = await inDraft(revisionId, async (tx) => {
    // Read under inDraft's row lock, so an edit saved meanwhile isn't undone.
    const [row] = await tx.select({ texts: budgetRevisions.texts }).from(budgetRevisions).where(eq(budgetRevisions.id, revisionId));
    const texts = readTexts(row?.texts);
    const { differs } = compareIdentity(texts.cover, identity);
    if (differs.length > 0) {
      await tx
        .update(budgetRevisions)
        .set({ texts: { ...texts, cover: withProjectIdentity(texts.cover, identity) } })
        .where(eq(budgetRevisions.id, revisionId));
    }
    return differs;
  }, { sync: false });
  return { revisionId, changed };
}

/** The sections of the texts sent over the stored ones (the cover's fields over the stored cover). */
function mergeTexts(sent: TextsChanges, current: BudgetTexts): BudgetTexts {
  const { cover, justification, ...sections } = changesOf(sent);
  return {
    ...current,
    ...sections,
    cover: cover ? { ...current.cover, ...changesOf(cover) } : current.cover,
    justification: justification
      ? { intro: justification.intro ?? current.justification.intro, blocks: justification.blocks ?? current.justification.blocks }
      : current.justification,
  };
}

/**
 * Body: any of { reference, vatRateBp, builtAreaM2, usefulAreaM2, exclusions,
 * contingencyPct, overheadPct, profitPct, quality, changeReason, texts (partial), conditions (partial),
 * review: { done: string[] } (the whole list), reviewed: { key, done } (one
 * check, merged with the stored list), exclusion: { text, included, save?, replaces? }
 * (one "Gasto no incluido" ticked or not, merged with the stored ones in the
 * library's order: ./budget-exclusions; `save` also adds it to the library;
 * `replaces`, a line of the budget it takes the place of) } — drafts only.
 */
export async function updateRevision(
  ctx: Ctx,
  projectId: string,
  revisionId: string,
  input: Record<string, unknown>,
) {
  const revision = await revisionInProject(ctx, projectId, revisionId);
  const { builtAreaM2, usefulAreaM2, contingencyPct, overheadPct, profitPct, texts, exclusions, exclusion, conditions, review, reviewed, ...columns } =
    changesOf(parse(revisionChangesSchema, input));
  const framer = revision.model === BUDGET_MODEL;
  const changes: Partial<typeof budgetRevisions.$inferInsert> = columns;
  // The API names the areas in m² and the contingency and margins in %; parse gives them in hundredths.
  if (builtAreaM2 !== undefined) changes.builtAreaCm2 = builtAreaM2;
  if (usefulAreaM2 !== undefined) changes.usefulAreaCm2 = usefulAreaM2;
  if (contingencyPct !== undefined) changes.contingencyBp = contingencyPct;
  if (overheadPct !== undefined) changes.overheadBp = overheadPct;
  if (profitPct !== undefined) changes.profitBp = profitPct;
  // Gastos and beneficio are shares of the price: the cost needs some of it left.
  if ((changes.overheadBp ?? revision.overheadBp) + (changes.profitBp ?? revision.profitBp) >= 10_000) {
    throw new CoreError("invalid_input", 400);
  }
  if (texts) changes.texts = mergeTexts(texts, readTexts(revision.texts));
  if (exclusions !== undefined) {
    // /api/v1's one-per-line string: a FRAMER revision keeps them in its texts.
    if (framer) changes.texts = { ...((changes.texts as BudgetTexts | undefined) ?? readTexts(revision.texts)), exclusions: lines(exclusions) };
    else changes.exclusions = exclusions;
  }
  if (conditions) changes.conditions = { ...readConditions(revision.conditions), ...changesOf(conditions) };
  if (review) changes.review = { done: [...new Set(review.done)] };
  // The checklist is a FRAMER budget's: an older one keeps its lines as one text (`exclusions`).
  if (exclusion && !framer) fail("invalid_state");
  if (Object.keys(changes).length > 0 || reviewed || exclusion) {
    await inDraft(revisionId, async (tx) => {
      if (exclusion) {
        const { text, included, save, replaces } = exclusion;
        // "Guardar para otros proyectos": the line joins the tenant's library with the draft's write.
        if (save) await addToLibrary(ctx, text, tx);
        // Where a ticked line goes: among the library's, in its order.
        const library = included ? (await libraryOf(ctx.tenantId, tx)).map((preset) => preset.label) : [];
        // Read under inDraft's row lock, like `reviewed`: lines ticked together all stick.
        const [row] = await tx.select({ texts: budgetRevisions.texts }).from(budgetRevisions).where(eq(budgetRevisions.id, revisionId));
        const stored = (changes.texts as BudgetTexts | undefined) ?? readTexts(row?.texts);
        const next = withExclusion(stored.exclusions, text, included, library, replaces);
        if (next.length > MAX_EXCLUSIONS) fail("too_many_exclusions");
        changes.texts = { ...stored, exclusions: next };
      }
      if (reviewed) {
        // Read under inDraft's row lock, so ticks sent together (two people, quick
        // clicks) all stick, and keys whose check is hidden for now are kept.
        const [row] = await tx.select({ review: budgetRevisions.review }).from(budgetRevisions).where(eq(budgetRevisions.id, revisionId));
        const keys = reviewedKeys(changes.review ?? row?.review);
        if (reviewed.done) keys.add(reviewed.key);
        else keys.delete(reviewed.key);
        if (keys.size > MAX_REVIEWED) fail("invalid_input");
        changes.review = { done: [...keys] };
      }
      await tx.update(budgetRevisions).set(changes).where(eq(budgetRevisions.id, revisionId));
    }, {
      // Only the percentage moves chapter 20.
      sync: "contingencyBp" in changes,
    });
  }
  return { revisionId };
}

/**
 * Makes an issued revision the contract, and keeps the proof of it: the day
 * the client accepted (`acceptedOn`: today unless given, never after today nor
 * before the day it was issued), who they are (`acceptedBy`, as typed), the
 * staff user registering it and when, and the client's signed copy if given.
 * The options the client chose join the contract; the revision it replaces,
 * and older issued ones, are superseded; progress recorded on the old contract
 * carries over to the same lines (by lineage).
 * Body (all optional): { acceptedOn, acceptedBy, chosenOptionIds, signed }
 * — `signed`, the client's signed copy (a PDF), is checked first and stored
 * with the project's contracts once accepted, linked to the revision.
 *
 * A draft was never sent to the client, so it is refused (`not_issued`).
 * `options.unissued` is the one way round it, for a contract signed outside
 * the platform (the seed's, an import) and for test fixtures: the portal's
 * action and the /api/v1 route never pass it.
 */
export async function acceptRevision(
  ctx: Ctx,
  projectId: string,
  revisionId: string,
  input: Record<string, unknown> = {},
  options: { unissued?: boolean } = {},
) {
  const revision = await revisionInProject(ctx, projectId, revisionId, { draft: false });
  const acceptable = (status: RevisionRow["status"]) => status === "issued" || (status === "draft" && options.unissued === true);
  if (!acceptable(revision.status)) fail("not_issued");
  const body = parse(acceptSchema, input);
  const acceptedOn = body.acceptedOn ?? todayInSpain();
  // Nobody accepts what they haven't been sent yet.
  const afterIssue = (issuedOn: string | null) => issuedOn === null || acceptedOn >= issuedOn;
  if (!afterIssue(revision.issuedOn)) fail("invalid_date");
  const { acceptedBy } = body;
  const chosen = await chosenOptions(revisionId, body.chosenOptionIds ?? []);
  // The signed copy is filed with the contracts, in the same step: if storing
  // it fails the revision isn't accepted, and the dialog can be sent again.
  const signed =
    body.signed == null
      ? null
      : newPdfDocument(ctx, projectId, await requirePdf(body.signed), {
          title: `Presupuesto ${revision.reference ?? ""} · Rev.${revision.number} · firmado`.replace("  ", " "),
          category: "contract",
        });

  const accept = () => db.transaction(async (tx) => {
    // The project, then the revision, as every write on the client's requests (budget-approvals.ts).
    await lockProjectRow(tx, ctx.tenantId, projectId);
    const [locked] = await tx
      .select({ status: budgetRevisions.status, issuedOn: budgetRevisions.issuedOn })
      .from(budgetRevisions)
      .where(eq(budgetRevisions.id, revisionId))
      .for("update");
    if (!locked || !acceptable(locked.status)) fail("not_issued");
    if (!afterIssue(locked.issuedOn)) fail("invalid_date");
    const [previous] = await tx
      .update(budgetRevisions)
      .set({ status: "superseded" })
      .where(and(eq(budgetRevisions.projectId, projectId), eq(budgetRevisions.status, "accepted")))
      .returning({ id: budgetRevisions.id });
    await tx
      .update(budgetRevisions)
      .set({ status: "superseded" })
      .where(
        and(
          eq(budgetRevisions.projectId, projectId),
          inArray(budgetRevisions.status, ["issued", "rejected"]),
          ne(budgetRevisions.id, revisionId),
        ),
      );
    if (previous) {
      // Line by lineage, from the old revision to the new.
      await tx.execute(sql`
        update ${budgetLines} as target
        set executed_pct = source.executed_pct
        from ${budgetLines} as source
        join ${budgetChapters} as source_chapter on source_chapter.id = source.chapter_id
        join ${budgetChapters} as target_chapter on target_chapter.revision_id = ${revisionId}
        where source_chapter.revision_id = ${previous.id}
          and target.chapter_id = target_chapter.id
          and target.lineage_id = source.lineage_id
      `);
    }
    const ofRevision = and(eq(budgetChapters.revisionId, revisionId), eq(budgetChapters.kind, "option"));
    await tx.update(budgetChapters).set({ chosen: false }).where(ofRevision);
    if (chosen.size > 0) {
      await tx
        .update(budgetChapters)
        .set({ chosen: true })
        .where(and(ofRevision, inArray(budgetChapters.id, [...chosen])));
    }
    // The document first: the revision points at it.
    if (signed) await tx.insert(projectDocuments).values(signed.row);
    await tx
      .update(budgetRevisions)
      .set({
        status: "accepted",
        acceptedAt: new Date(),
        acceptedOn,
        acceptedBy,
        acceptedByUserId: ctx.userId,
        acceptedDocumentId: signed?.row.id ?? null,
        // The client's approval in the app of exactly these options, if any, is proof too.
        acceptedApprovalId: await approvalAsProof(tx, revisionId, chosen),
      })
      .where(eq(budgetRevisions.id, revisionId));
    // Staff decided: no request to the client stays open on the project (the obra is marked below).
    await lapseApprovals(tx, projectId, ctx.userId);
  });
  if (signed) {
    await storeFiles([signed.file], accept);
    await markChanged(ctx.tenantId, projectId, ["obra", "documents"]);
    await notifyProjectClient(ctx.tenantId, projectId, { kind: "document", title: signed.row.title });
  } else {
    await accept();
    await markChanged(ctx.tenantId, projectId, ["obra"]);
  }
  await raiseStage(ctx.tenantId, projectId);
  return { revisionId };
}

/**
 * The client turned an issued revision down (registered by staff). A request
 * to approve it in the app still waiting lapses. Body: { rejectedOn? }
 */
export async function rejectRevision(
  ctx: Ctx,
  projectId: string,
  revisionId: string,
  input: Record<string, unknown> = {},
) {
  const revision = await revisionInProject(ctx, projectId, revisionId, { draft: false });
  if (revision.status !== "issued") fail("not_issued");
  const rejectedOn = parse(rejectSchema, input).rejectedOn ?? todayInSpain();
  const lapsed = await db.transaction(async (tx) => {
    await lockProjectRow(tx, ctx.tenantId, projectId);
    const [updated] = await tx
      .update(budgetRevisions)
      .set({ status: "rejected", rejectedOn })
      .where(and(eq(budgetRevisions.id, revisionId), eq(budgetRevisions.status, "issued")))
      .returning({ id: budgetRevisions.id });
    if (!updated) fail("not_issued");
    return lapseApprovals(tx, projectId, ctx.userId, { only: revisionId });
  });
  // The client's app stops showing the request.
  if (lapsed > 0) await markChanged(ctx.tenantId, projectId, ["obra"]);
  return { revisionId };
}

export async function deleteRevision(ctx: Ctx, projectId: string, revisionId: string) {
  await revisionInProject(ctx, projectId, revisionId);
  await inDraft(revisionId, (tx) => tx.delete(budgetRevisions).where(eq(budgetRevisions.id, revisionId)), { sync: false });
  return { revisionId };
}

// ─── Chapters ────────────────────────────────────────────────────────────────

/** Runs a chapter write, turning a clash of codes within the revision into `duplicate_code`. */
export async function withFreeCode<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error, "budget_chapters_revision_code_unique")) fail("duplicate_code");
    throw error;
  }
}

/** Body: { code, name, changeNote? } — budgets entered before the FRAMER model only. */
export async function addChapter(
  ctx: Ctx,
  projectId: string,
  revisionId: string,
  input: Record<string, unknown>,
) {
  const revision = await revisionInProject(ctx, projectId, revisionId);
  // The FRAMER model has its twenty chapters; options go through budget-options.ts.
  if (revision.model === BUDGET_MODEL) fail("fixed_chapters");
  const values = parse(newChapterSchema, input);
  const [chapter] = await withFreeCode(() =>
    inDraft(revisionId, (tx) =>
      tx
        .insert(budgetChapters)
        .values({
          ...values,
          tenantId: ctx.tenantId,
          revisionId,
          position: nextPosition(budgetChapters, budgetChapters.position, eq(budgetChapters.revisionId, revisionId)),
        })
        .returning({ id: budgetChapters.id }),
    ),
  );
  return { chapterId: chapter!.id };
}

/** Body: { code?, name?, changeNote?, pdfNote? } — a FRAMER chapter keeps its code. */
export async function updateChapter(
  ctx: Ctx,
  projectId: string,
  chapterId: string,
  input: Record<string, unknown>,
) {
  const chapter = await chapterInProject(ctx, projectId, chapterId);
  // As sent, before it is read: a FRAMER chapter's code never changes.
  if (chapter.model === BUDGET_MODEL && input.code !== undefined && input.code !== chapter.code) fail("fixed_chapters");
  const changes = changesOf(parse(chapterChangesSchema, input));
  if (Object.keys(changes).length > 0) {
    await withFreeCode(() =>
      inDraft(chapter.revisionId, (tx) => tx.update(budgetChapters).set(changes).where(eq(budgetChapters.id, chapterId)), {
        sync: chapter.model !== BUDGET_MODEL,
      }),
    );
  }
  return { chapterId };
}

/** Deletes a chapter of a pre-FRAMER budget, or an option. */
export async function deleteChapter(ctx: Ctx, projectId: string, chapterId: string) {
  const chapter = await chapterInProject(ctx, projectId, chapterId);
  if (chapter.model === BUDGET_MODEL && chapter.kind === "chapter") fail("fixed_chapters");
  await inDraft(chapter.revisionId, (tx) => tx.delete(budgetChapters).where(eq(budgetChapters.id, chapterId)));
  return { chapterId };
}

// ─── Lines ───────────────────────────────────────────────────────────────────

/** Chapter 20's line follows the others; nothing else may be written to it. */
const isComputedChapter = (chapter: { kind: string; code: string; model: string | null }) =>
  chapter.model === BUDGET_MODEL && chapter.kind === "chapter" && chapter.code === CONTINGENCY_CHAPTER;

/**
 * Body: { code?, description, unit, quantity, unitPriceCents, note?, source? }.
 * With `baseCode`, the description, unit and price default to the price base
 * entry's. Without a code, a FRAMER chapter's line takes the price base
 * code if the chapter doesn't have it yet, else the next free one;
 * an option's line is numbered with the options (OP.01…).
 */
export async function addLine(
  ctx: Ctx,
  projectId: string,
  chapterId: string,
  input: Record<string, unknown>,
) {
  const chapter = await chapterInProject(ctx, projectId, chapterId);
  if (isComputedChapter(chapter)) fail("fixed_chapters");
  const kind = chapter.kind;
  const { baseCode } = parse(lineBaseSchema, input);
  const base = baseCode === undefined ? null : (priceBaseItem(baseCode) ?? fail("invalid_input"));
  const autoCode = input.code === undefined && (kind === "option" || chapter.model === BUDGET_MODEL);
  // The price base entry gives what isn't sent (or is null).
  const given = {
    ...input,
    code: input.code ?? base?.code,
    description: input.description ?? base?.description,
    unit: input.unit ?? base?.unit,
    unitPriceCents: input.unitPriceCents ?? base?.unitPriceCents,
  };
  const { quantity, source, ...fields } = autoCode
    ? { ...parse(numberedLineSchemas[kind], given), code: "" }
    : parse(newLineSchemas[kind], given);
  const values = { ...fields, quantityMilli: quantity, source: source ?? (base ? "base" : "manual"), baseCode: base?.code ?? null };
  const [line] = await inDraft(chapter.revisionId, async (tx) =>
    tx
      .insert(budgetLines)
      .values({
        ...values,
        code: !autoCode ? values.code : kind === "option" ? "OP.00" : await nextLineCode(tx, chapterId, chapter.code, base?.code),
        tenantId: ctx.tenantId,
        chapterId,
        position: nextPosition(budgetLines, budgetLines.position, eq(budgetLines.chapterId, chapterId)),
      })
      .returning({ id: budgetLines.id }),
  );
  return { lineId: line!.id };
}

/**
 * Body: any of { code, description, unit, quantity, unitPriceCents, note,
 * source, chapterId } — drafts only. `chapterId` moves the line to another
 * chapter of the same revision (not to chapter 20, nor between chapters and options).
 */
export async function updateLine(
  ctx: Ctx,
  projectId: string,
  lineId: string,
  input: Record<string, unknown>,
) {
  const row = await draftLine(ctx, projectId, lineId);
  if (row.line.source === "computed") fail("fixed_chapters");
  // An option line's code follows its position: its schema leaves it out.
  const { quantity, chapterId, ...columns } = changesOf(parse(lineChangesSchemas[row.chapterKind], input));
  const changes = quantity === undefined ? columns : { ...columns, quantityMilli: quantity };
  let move = {};
  if (chapterId !== undefined && chapterId !== row.line.chapterId) {
    const target = await chapterInProject(ctx, projectId, chapterId);
    if (target.revisionId !== row.revisionId || target.kind !== row.chapterKind || isComputedChapter(target)) fail("invalid_input");
    move = { chapterId: target.id, position: nextPosition(budgetLines, budgetLines.position, eq(budgetLines.chapterId, target.id)) };
  }
  if (Object.keys(changes).length > 0 || Object.keys(move).length > 0) {
    await inDraft(row.revisionId, (tx) => tx.update(budgetLines).set({ ...changes, ...move }).where(eq(budgetLines.id, lineId)));
  }
  return { lineId };
}

export async function deleteLine(ctx: Ctx, projectId: string, lineId: string) {
  const row = await draftLine(ctx, projectId, lineId);
  if (row.line.source === "computed") fail("fixed_chapters");
  await inDraft(row.revisionId, (tx) => tx.delete(budgetLines).where(eq(budgetLines.id, lineId)));
  return { lineId };
}

// ─── Progress ────────────────────────────────────────────────────────────────

/**
 * Records how much of each line is built. Only on the accepted revision.
 * Body: { lines: [{ id, executedPct (0–100) }] } — for a repeated id, the last wins.
 */
export async function setProgress(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const updates = new Map(parse(progressSchema, input).lines.map(({ id, executedPct }) => [id, executedPct]));
  if (updates.size === 0) {
    await requireProject(ctx.tenantId, projectId);
    return { updated: 0 };
  }

  const rows = await linesInProject(ctx, projectId, [...updates.keys()]);
  if (rows.some((r) => r.status !== "accepted")) fail("not_accepted");

  const values = sql.join(
    [...updates].map(([id, pct]) => sql`(${id}, ${pct}::integer)`),
    sql`, `,
  );
  await db.transaction(async (tx) => {
    // Holds off acceptRevision (which supersedes this revision and copies its
    // progress) until this save is in, and fails if it got there first.
    const [accepted] = await tx
      .select({ id: budgetRevisions.id })
      .from(budgetRevisions)
      .where(and(eq(budgetRevisions.projectId, projectId), eq(budgetRevisions.status, "accepted")))
      .for("update");
    if (!accepted || rows.some((r) => r.revisionId !== accepted.id)) fail("not_accepted");
    await tx.execute(sql`
      update ${budgetLines}
      set executed_pct = v.pct, updated_at = now()
      from (values ${values}) as v(id, pct)
      where ${budgetLines.id} = v.id
    `);
  });
  await markChanged(ctx.tenantId, projectId, ["obra"]);
  return { updated: updates.size };
}
