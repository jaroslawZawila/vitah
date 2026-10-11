import {
  and,
  budgetChapters,
  budgetLines,
  budgetRevisions,
  db,
  desc,
  eq,
  inArray,
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
  draftLine,
  inDraft,
  linesInProject,
  lockForFirstBudget,
  lockProject,
  nextLineCode,
  revisionInProject,
  syncDraft,
} from "./budget-draft";
import { computeChecks, reviewedKeys, tenantRatios } from "./budget-review";
import { markChanged } from "./changes";
import { requireEditor, type Ctx } from "./context";
import {
  ANNEX_KINDS,
  BUDGET_MODEL,
  BUDGET_QUALITIES,
  CONTINGENCY_CHAPTER,
  MAX_CHAPTER_CODE,
  type BudgetChapter,
  type BudgetConditions,
  type BudgetLineChange,
  type BudgetOption,
  type BudgetPdfKind,
  type BudgetQuality,
  type BudgetRevision,
  type BudgetRevisionSummary,
  type BudgetTexts,
  type ChapterChange,
  type LineSource,
  type ProjectBudget,
} from "./contract";
import { getLatestGeneration } from "./budget-generations";
import { createDefaultHitos } from "./hitos";
import type { Tx } from "./project-client";
import { ofBp, perM2Cents, shareBp, todayInSpain } from "./obra-calc";
import {
  calendarDate,
  fail,
  integer,
  linesTotalSql,
  loadChapters,
  nextPosition,
  optionalText,
  pickChanges,
  requireProject,
  requiredText,
  scaled,
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

const MAX_NAME = 200;
const MAX_DESCRIPTION = 2_000;
const MAX_UNIT = 10;
const MAX_NOTE = 2_000;
const MAX_TEXT = 10_000;
const MAX_QUANTITY = 1_000_000;
const MAX_AREA_M2 = 1_000_000;
const MAX_UNIT_PRICE_CENTS = 100_000_000;
const MAX_BLOCKS = 50;

// ─── Reading ─────────────────────────────────────────────────────────────────

/** Each revision's PEC (chapters only, never options), rounding each line as `amountCents` does. */
async function revisionTotals(projectId: string) {
  const rows = await db
    .select({
      revisionId: budgetChapters.revisionId,
      total: linesTotalSql(),
    })
    .from(budgetLines)
    .innerJoin(budgetChapters, eq(budgetChapters.id, budgetLines.chapterId))
    .innerJoin(budgetRevisions, eq(budgetRevisions.id, budgetChapters.revisionId))
    .where(and(eq(budgetRevisions.projectId, projectId), eq(budgetChapters.kind, "chapter")))
    .groupBy(budgetChapters.revisionId);
  return new Map(rows.map((r) => [r.revisionId, Number(r.total)]));
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
 * A revision's chapters as the API shows them: shares of `totalCents`, the
 * hito closing each, and how each changed against `before` (the previous
 * revision's chapters; null when there is none).
 */
export function toBudgetChapters(
  chapters: LoadedChapter[],
  before: LoadedChapter[] | null,
  totalCents: number,
  hitoOf: Map<string, string>,
  { framer = false, builtAreaCm2 = null as number | null } = {},
): BudgetChapter[] {
  const previousTotals = new Map(before?.map((c) => [c.code, c.totalCents]));
  return chapters.map((chapter) => {
    const previousTotal = previousTotals.get(chapter.code);
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
      shareBp: shareBp(chapter.totalCents, totalCents),
      previousTotalCents: previousTotal ?? null,
      change: before ? change(chapter.totalCents, previousTotal) : null,
      hitoCode: hitoOf.get(chapter.code) ?? null,
      lines: chapter.lines,
      computed: framer && chapter.kind === "chapter" && chapter.code === CONTINGENCY_CHAPTER,
      lineCount: countLines([chapter]),
      perM2Cents: perM2Cents(chapter.totalCents, builtAreaCm2),
    };
  });
}

/** Lines staff wrote (chapter 20's computed line isn't one). */
const countLines = (chapters: LoadedChapter[]) =>
  chapters.reduce((sum, c) => sum + c.lines.filter((l) => l.source !== "computed").length, 0);

/** How many options add or subtract, and by how much. */
function optionTotals(options: LoadedChapter[]) {
  const side = (list: LoadedChapter[]) => ({ count: list.length, cents: list.reduce((sum, o) => sum + o.totalCents, 0) });
  return { adding: side(options.filter((o) => o.totalCents > 0)), subtracting: side(options.filter((o) => o.totalCents < 0)) };
}

function toOptions(
  options: LoadedChapter[],
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

function toSummary(row: RevisionRow, totalCents: number): BudgetRevisionSummary {
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
    .where(eq(projectDocuments.budgetRevisionId, revisionId));
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
  const [loaded, before, hitoOf, pdfs, ratios] = await Promise.all([
    loadChapters(row.id),
    previous ? loadChapters(previous.id) : null,
    hitoByChapter(row.projectId),
    revisionPdfs(row.id),
    row.model === BUDGET_MODEL ? tenantRatios(row.tenantId, row.projectId) : {},
  ]);
  const chapters = loaded.filter((c) => c.kind === "chapter");
  const options = loaded.filter((c) => c.kind === "option");
  const beforeChapters = before?.filter((c) => c.kind === "chapter") ?? null;
  const beforeOptions = before?.filter((c) => c.kind === "option") ?? null;
  const totalCents = totals.get(row.id) ?? 0;
  const chosenCents = options.filter((o) => o.chosen).reduce((sum, o) => sum + o.totalCents, 0);
  const codes = new Set(chapters.map((c) => c.code));
  const framer = row.model === BUDGET_MODEL;
  const texts = framer ? readTexts(row.texts) : { ...defaultTexts(), exclusions: lines(row.exclusions) };
  const view = { framer, builtAreaCm2: row.builtAreaCm2 };
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
    chapters: toBudgetChapters(chapters, beforeChapters, totalCents, hitoOf, view),
    lineCount: countLines(chapters),
    perM2Cents: perM2Cents(totalCents, row.builtAreaCm2),
    optionTotals: optionTotals(options),
    model: row.model,
    options: toOptions(options, beforeOptions, hitoOf, view),
    contractTotalCents: totalCents + chosenCents,
    contingencyBp: row.contingencyBp,
    quality: row.quality,
    texts,
    conditions: readConditions(row.conditions),
    changeReason: row.changeReason,
    validUntil: row.validUntil,
    acceptedOn: row.acceptedOn,
    acceptedBy: row.acceptedBy,
    rejectedOn: row.rejectedOn,
    pdfs,
    checks: framer
      ? computeChecks({ texts, chapters, builtAreaCm2: row.builtAreaCm2, ratios, done: reviewedKeys(row.review) })
      : [],
    ratios,
    lineChanges: before ? lineChanges(loaded, before) : [],
  };
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
 * if the project has none yet. The caller holds the project lock.
 */
export async function insertFramerRevision(
  tx: Tx,
  tenantId: string,
  projectId: string,
  values: NewRevision,
  notes: ChapterNotes = new Map(),
) {
  const [revision] = await tx
    .insert(budgetRevisions)
    .values({
      tenantId,
      projectId,
      model: BUDGET_MODEL,
      texts: defaultTexts(),
      conditions: defaultConditions(),
      ...values,
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
  const reference = optionalText(input.reference, MAX_NAME);
  const number = input.number === undefined ? 0 : integer(input.number, 0, 999);

  const created = await db.transaction(async (tx) => {
    await lockForFirstBudget(tx, projectId);
    const { revisionId, contingencyBp } = await insertFramerRevision(tx, ctx.tenantId, projectId, { reference, number });
    await syncDraft(tx, revisionId, { tenantId: ctx.tenantId, contingencyBp });
    return { revisionId };
  });
  // The app shows the new hitos.
  await markChanged(ctx.tenantId, projectId, ["obra"]);
  return created;
}

/** A new draft copied from the newest revision (issued, rejected or accepted), progress included. */
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
    const { model, contingencyBp, quality, texts, conditions } = newest;
    const [revision] = await tx
      .insert(budgetRevisions)
      .values({
        ...{ tenantId, projectId, reference, vatRateBp, builtAreaCm2, usefulAreaCm2, exclusions },
        ...{ model, contingencyBp, quality, texts, conditions },
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

/** Partial texts over the stored ones; each section is validated as a whole. */
function parseTexts(value: unknown, current: BudgetTexts): BudgetTexts {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("invalid_input");
  const input = value as Record<string, unknown>;
  const str = (v: unknown, max = MAX_TEXT) => (typeof v === "string" && v.length <= max ? v : fail("invalid_input"));
  const list = <T>(v: unknown, parse: (item: Record<string, unknown>) => T): T[] => {
    if (!Array.isArray(v) || v.length > MAX_BLOCKS) fail("invalid_input");
    return v.map((item) => {
      if (typeof item !== "object" || item === null) fail("invalid_input");
      return parse(item as Record<string, unknown>);
    });
  };
  const texts = { ...current };
  if ("cover" in input) {
    const cover = input.cover as Record<string, unknown> | null;
    if (typeof cover !== "object" || cover === null) fail("invalid_input");
    texts.cover = { ...current.cover };
    for (const key of Object.keys(current.cover) as (keyof BudgetTexts["cover"])[]) {
      if (key in cover) texts.cover[key] = str(cover[key], 2_000);
    }
  }
  if ("justification" in input) {
    const j = input.justification as Record<string, unknown> | null;
    if (typeof j !== "object" || j === null) fail("invalid_input");
    texts.justification = {
      intro: "intro" in j ? str(j.intro) : current.justification.intro,
      blocks:
        "blocks" in j
          ? list(j.blocks, (b) => ({ title: str(b.title, MAX_NAME), text: str(b.text) }))
          : current.justification.blocks,
    };
  }
  if ("measurementCriterion" in input) texts.measurementCriterion = str(input.measurementCriterion);
  if ("annex" in input) {
    texts.annex = list(input.annex, (item) => {
      const kind = ANNEX_KINDS.find((k) => k === item.kind) ?? fail("invalid_input");
      const id = typeof item.id === "string" && item.id ? item.id.slice(0, 40) : crypto.randomUUID();
      return { id, kind, title: str(item.title, MAX_NAME), text: str(item.text) };
    });
  }
  if ("exclusions" in input) {
    if (!Array.isArray(input.exclusions) || input.exclusions.length > MAX_BLOCKS) fail("invalid_input");
    texts.exclusions = input.exclusions.map((v) => str(v, 2_000).trim()).filter(Boolean);
  }
  if ("includes" in input) texts.includes = str(input.includes);
  return texts;
}

function parseConditions(value: unknown, current: BudgetConditions): BudgetConditions {
  if (typeof value !== "object" || value === null || Array.isArray(value)) fail("invalid_input");
  const input = value as Record<string, unknown>;
  const changes = pickChanges<BudgetConditions>(input, {
    validityDays: (v) => integer(v, 1, 365),
    term: (v) => optionalText(v, MAX_NAME) ?? "",
    penalty: (v) => optionalText(v, MAX_NAME) ?? "",
    signingPlace: (v) => optionalText(v, MAX_NAME) ?? "",
  });
  return { ...current, ...changes };
}

/**
 * Body: any of { reference, vatRateBp, builtAreaM2, usefulAreaM2, exclusions,
 * contingencyPct, quality, changeReason, texts (partial), conditions (partial),
 * review: { done: string[] } } — drafts only.
 */
export async function updateRevision(
  ctx: Ctx,
  projectId: string,
  revisionId: string,
  input: Record<string, unknown>,
) {
  const revision = await revisionInProject(ctx, projectId, revisionId);
  const area = (value: unknown) => (value === null ? null : scaled(value, MAX_AREA_M2, 100));
  const framer = revision.model === BUDGET_MODEL;
  const changes = pickChanges<typeof budgetRevisions.$inferInsert>(input, {
    reference: (v) => optionalText(v, MAX_NAME),
    vatRateBp: (v) => integer(v, 0, 10_000),
    quality: (v) => (v === null ? null : (BUDGET_QUALITIES.find((q) => q === v) ?? fail("invalid_input"))),
    changeReason: (v) => optionalText(v, MAX_NOTE),
  });
  // The API names the areas in m² and the contingency in %; they're stored in hundredths.
  if ("builtAreaM2" in input) changes.builtAreaCm2 = area(input.builtAreaM2);
  if ("usefulAreaM2" in input) changes.usefulAreaCm2 = area(input.usefulAreaM2);
  if ("contingencyPct" in input) changes.contingencyBp = scaled(input.contingencyPct, 50, 100);
  if ("texts" in input) changes.texts = parseTexts(input.texts, readTexts(revision.texts));
  if ("exclusions" in input) {
    // /api/v1's one-per-line string: a FRAMER revision keeps them in its texts.
    const exclusions = optionalText(input.exclusions, MAX_TEXT);
    if (framer) changes.texts = { ...((changes.texts as BudgetTexts | undefined) ?? readTexts(revision.texts)), exclusions: lines(exclusions) };
    else changes.exclusions = exclusions;
  }
  if ("conditions" in input) changes.conditions = parseConditions(input.conditions, readConditions(revision.conditions));
  if ("review" in input) {
    const done = (input.review as { done?: unknown } | null)?.done;
    if (!Array.isArray(done) || done.some((key) => typeof key !== "string" || key.length > 80)) fail("invalid_input");
    changes.review = { done: [...new Set(done as string[])] };
  }
  if (Object.keys(changes).length > 0) {
    await inDraft(revisionId, (tx) => tx.update(budgetRevisions).set(changes).where(eq(budgetRevisions.id, revisionId)), {
      // Only the percentage moves chapter 20.
      sync: "contingencyBp" in changes,
    });
  }
  return { revisionId };
}

/** Reads `chosenOptionIds`: options of this revision. */
async function chosenOptions(revisionId: string, value: unknown): Promise<Set<string>> {
  if (value === undefined) return new Set();
  if (!Array.isArray(value) || value.some((id) => typeof id !== "string")) fail("invalid_input");
  const ids = new Set(value as string[]);
  if (ids.size === 0) return ids;
  const found = await db
    .select({ id: budgetChapters.id })
    .from(budgetChapters)
    .where(
      and(
        eq(budgetChapters.revisionId, revisionId),
        eq(budgetChapters.kind, "option"),
        inArray(budgetChapters.id, [...ids]),
      ),
    );
  if (found.length !== ids.size) fail("not_found");
  return ids;
}

/**
 * Makes an issued revision the contract (a draft too, for /api/v1 callers
 * that predate issuing). The options the client chose join the contract; the
 * revision it replaces, and older issued ones, are superseded; progress
 * recorded on the old contract carries over to the same lines (by lineage).
 * Body (all optional): { acceptedOn, acceptedBy, chosenOptionIds, signed }
 * — `signed`, the client's signed copy (a PDF), is checked first and stored
 * with the project's contracts once accepted.
 */
export async function acceptRevision(
  ctx: Ctx,
  projectId: string,
  revisionId: string,
  input: Record<string, unknown> = {},
) {
  const revision = await revisionInProject(ctx, projectId, revisionId, { draft: false });
  if (revision.status !== "draft" && revision.status !== "issued") fail("not_issued");
  const acceptedOn = input.acceptedOn === undefined ? todayInSpain() : calendarDate(input.acceptedOn);
  const acceptedBy = optionalText(input.acceptedBy, MAX_NAME);
  const chosen = await chosenOptions(revisionId, input.chosenOptionIds);
  // The signed copy is filed with the contracts, in the same step: if storing
  // it fails the revision isn't accepted, and the dialog can be sent again.
  const signed =
    input.signed == null
      ? null
      : newPdfDocument(ctx, projectId, await requirePdf(input.signed), {
          title: `Presupuesto ${revision.reference ?? ""} · Rev.${revision.number} · firmado`.replace("  ", " "),
          category: "contract",
        });

  const accept = () => db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: budgetRevisions.status })
      .from(budgetRevisions)
      .where(eq(budgetRevisions.id, revisionId))
      .for("update");
    if (!locked || (locked.status !== "draft" && locked.status !== "issued")) fail("not_issued");
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
    const options = and(eq(budgetChapters.revisionId, revisionId), eq(budgetChapters.kind, "option"));
    await tx.update(budgetChapters).set({ chosen: false }).where(options);
    if (chosen.size > 0) {
      await tx
        .update(budgetChapters)
        .set({ chosen: true })
        .where(and(options, inArray(budgetChapters.id, [...chosen])));
    }
    await tx
      .update(budgetRevisions)
      .set({ status: "accepted", acceptedAt: new Date(), acceptedOn, acceptedBy })
      .where(eq(budgetRevisions.id, revisionId));
    if (signed) await tx.insert(projectDocuments).values(signed.row);
  });
  if (signed) {
    await storeFiles([signed.file], accept);
    await markChanged(ctx.tenantId, projectId, ["obra", "documents"]);
    await notifyProjectClient(ctx.tenantId, projectId, { kind: "document", title: signed.row.title });
  } else {
    await accept();
    await markChanged(ctx.tenantId, projectId, ["obra"]);
  }
  return { revisionId };
}

/** The client turned an issued revision down. Body: { rejectedOn? } */
export async function rejectRevision(
  ctx: Ctx,
  projectId: string,
  revisionId: string,
  input: Record<string, unknown> = {},
) {
  const revision = await revisionInProject(ctx, projectId, revisionId, { draft: false });
  if (revision.status !== "issued") fail("not_issued");
  const rejectedOn = input.rejectedOn === undefined ? todayInSpain() : calendarDate(input.rejectedOn);
  const [updated] = await db
    .update(budgetRevisions)
    .set({ status: "rejected", rejectedOn })
    .where(and(eq(budgetRevisions.id, revisionId), eq(budgetRevisions.status, "issued")))
    .returning({ id: budgetRevisions.id });
  if (!updated) fail("not_issued");
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
  const values = {
    code: requiredText(input.code, MAX_CHAPTER_CODE),
    name: requiredText(input.name, MAX_NAME),
    changeNote: optionalText(input.changeNote, MAX_NOTE),
  };
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
  if (chapter.model === BUDGET_MODEL && "code" in input && input.code !== chapter.code) fail("fixed_chapters");
  const changes = pickChanges<typeof budgetChapters.$inferInsert>(input, {
    code: (v) => requiredText(v, MAX_CHAPTER_CODE),
    name: (v) => requiredText(v, MAX_NAME),
    changeNote: (v) => optionalText(v, MAX_NOTE),
    pdfNote: (v) => optionalText(v, MAX_NOTE),
  });
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

/**
 * Line fields; an option's lines may have a negative price (a deduction), and
 * their code is assigned by the option numbering (OP.01…).
 */
function lineParsers(kind: "chapter" | "option") {
  return {
    code: (v: unknown) => requiredText(v, MAX_CHAPTER_CODE),
    description: (v: unknown) => requiredText(v, MAX_DESCRIPTION),
    unit: (v: unknown) => requiredText(v, MAX_UNIT),
    quantityMilli: (v: unknown) => scaled(v, MAX_QUANTITY, 1000),
    unitPriceCents: (v: unknown) =>
      v === undefined
        ? fail("missing_fields")
        : integer(v, kind === "option" ? -MAX_UNIT_PRICE_CENTS : 0, MAX_UNIT_PRICE_CENTS),
    note: (v: unknown) => optionalText(v, MAX_NOTE),
    source: (v: unknown) => (v === "base" || v === "estimated" || v === "manual" ? (v as LineSource) : fail("invalid_input")),
  };
}

/** The API's `quantity` is stored in thousandths as `quantityMilli` (which the API never takes). */
const lineInput = ({ quantity, quantityMilli: _, ...input }: Record<string, unknown>) =>
  quantity === undefined ? input : { ...input, quantityMilli: quantity };

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
  const parse = lineParsers(kind);
  const base = typeof input.baseCode === "string" ? priceBaseItem(input.baseCode) : null;
  if (input.baseCode !== undefined && !base) fail("invalid_input");
  const fields = lineInput(input);
  const autoCode = fields.code === undefined && (kind === "option" || chapter.model === BUDGET_MODEL);
  const values = {
    code: autoCode ? "" : parse.code(fields.code ?? base?.code),
    description: parse.description(fields.description ?? base?.description),
    unit: parse.unit(fields.unit ?? base?.unit),
    quantityMilli: parse.quantityMilli(fields.quantityMilli),
    unitPriceCents: parse.unitPriceCents(fields.unitPriceCents ?? base?.unitPriceCents),
    note: parse.note(fields.note),
    source: fields.source === undefined ? (base ? "base" : "manual") : parse.source(fields.source),
    baseCode: base?.code ?? null,
  };
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
  const kind = row.chapterKind;
  const { code: _, ...withoutCode } = lineInput(input);
  const changes = pickChanges<typeof budgetLines.$inferInsert>(
    // An option line's code follows its position.
    kind === "option" ? withoutCode : lineInput(input),
    lineParsers(kind),
  );
  let move = {};
  if ("chapterId" in input && input.chapterId !== row.line.chapterId) {
    if (typeof input.chapterId !== "string") fail("invalid_input");
    const target = await chapterInProject(ctx, projectId, input.chapterId);
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
  if (!Array.isArray(input.lines)) fail("missing_fields");
  const updates = new Map<string, number>();
  for (const entry of input.lines as unknown[]) {
    const { id, executedPct } = (entry ?? {}) as Record<string, unknown>;
    if (typeof id !== "string") fail("invalid_input");
    updates.set(id, integer(executedPct, 0, 100));
  }
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
