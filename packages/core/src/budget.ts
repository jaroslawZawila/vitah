import {
  and,
  budgetChapters,
  budgetLines,
  budgetRevisions,
  db,
  desc,
  eq,
  inArray,
  lt,
  obraHitoChapters,
  obraHitos,
  projects,
  sql,
} from "@repo/db";
import { isUniqueViolation } from "./accounts";
import type { Ctx } from "./context";
import {
  MAX_CHAPTER_CODE,
  type BudgetChapter,
  type BudgetRevision,
  type BudgetRevisionSummary,
  type ChapterChange,
  type ProjectBudget,
} from "./contract";
import { createDefaultHitos } from "./hitos";
import type { Tx } from "./project-client";
import { ofBp, shareBp } from "./obra-calc";
import {
  fail,
  integer,
  loadChapters,
  nextPosition,
  optionalText,
  pickChanges,
  requireEditor,
  requireProject,
  requiredText,
  scaled,
  type LoadedChapter,
  type RevisionRow,
} from "./obra-data";

// ─── Budget ──────────────────────────────────────────────────────────────────
// A project's budget in the FRAMER model: revisions of chapters and lines. A
// draft is edited freely; accepting it makes it the contract, and from then
// on staff only record each line's executed %. A change to the contract is a
// new revision (copied from the newest), accepted in turn.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_NAME = 200;
const MAX_DESCRIPTION = 2_000;
const MAX_UNIT = 10;
const MAX_NOTE = 1_000;
const MAX_QUANTITY = 1_000_000;
const MAX_AREA_M2 = 1_000_000;
const MAX_UNIT_PRICE_CENTS = 100_000_000;

// ─── Reading ─────────────────────────────────────────────────────────────────

/** Each revision's total, rounding each line as `amountCents` (contract) does. */
async function revisionTotals(projectId: string) {
  const rows = await db
    .select({
      revisionId: budgetChapters.revisionId,
      total: sql<string>`coalesce(sum(round(${budgetLines.quantityMilli}::numeric * ${budgetLines.unitPriceCents} / 1000)), 0)`,
    })
    .from(budgetLines)
    .innerJoin(budgetChapters, eq(budgetChapters.id, budgetLines.chapterId))
    .innerJoin(budgetRevisions, eq(budgetRevisions.id, budgetChapters.revisionId))
    .where(eq(budgetRevisions.projectId, projectId))
    .groupBy(budgetChapters.revisionId);
  return new Map(rows.map((r) => [r.revisionId, Number(r.total)]));
}

/** Which hito closes each chapter code. */
async function hitoByChapter(projectId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ chapterCode: obraHitoChapters.chapterCode, hitoCode: obraHitos.code })
    .from(obraHitoChapters)
    .innerJoin(obraHitos, eq(obraHitos.id, obraHitoChapters.hitoId))
    .where(eq(obraHitoChapters.projectId, projectId));
  return new Map(rows.map((r) => [r.chapterCode, r.hitoCode]));
}

/** The chapters of the revision before `revision`, or null when it is the first. */
export async function previousChapters(revision: RevisionRow): Promise<LoadedChapter[] | null> {
  const [previous] = await db
    .select({ id: budgetRevisions.id })
    .from(budgetRevisions)
    .where(
      and(
        eq(budgetRevisions.projectId, revision.projectId),
        lt(budgetRevisions.number, revision.number),
      ),
    )
    .orderBy(desc(budgetRevisions.number))
    .limit(1);
  return previous ? loadChapters(previous.id) : null;
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
): BudgetChapter[] {
  const previousTotals = new Map(before?.map((c) => [c.code, c.totalCents]));
  return chapters.map((chapter) => {
    const previousTotal = previousTotals.get(chapter.code);
    return {
      id: chapter.id,
      code: chapter.code,
      name: chapter.name,
      changeNote: chapter.changeNote,
      totalCents: chapter.totalCents,
      executedCents: chapter.executedCents,
      progressPct: chapter.progressPct,
      status: chapter.status,
      shareBp: shareBp(chapter.totalCents, totalCents),
      previousTotalCents: previousTotal ?? null,
      change: before ? change(chapter.totalCents, previousTotal) : null,
      hitoCode: hitoOf.get(chapter.code) ?? null,
      lines: chapter.lines,
    };
  });
}

function toSummary(row: RevisionRow, totalCents: number): BudgetRevisionSummary {
  return {
    id: row.id,
    number: row.number,
    status: row.status,
    totalCents,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
  };
}

/** A revision in full, compared with the one before it. */
async function revisionView(
  row: RevisionRow,
  previous: RevisionRow | undefined,
  totals: Map<string, number>,
): Promise<BudgetRevision> {
  const [chapters, before, hitoOf] = await Promise.all([
    loadChapters(row.id),
    previous ? loadChapters(previous.id) : null,
    hitoByChapter(row.projectId),
  ]);
  const totalCents = totals.get(row.id) ?? 0;
  const codes = new Set(chapters.map((c) => c.code));
  return {
    ...toSummary(row, totalCents),
    reference: row.reference,
    vatRateBp: row.vatRateBp,
    vatCents: ofBp(totalCents, row.vatRateBp),
    builtAreaM2: row.builtAreaCm2 === null ? null : row.builtAreaCm2 / 100,
    usefulAreaM2: row.usefulAreaCm2 === null ? null : row.usefulAreaCm2 / 100,
    exclusions: (row.exclusions ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    previous: previous ? { number: previous.number, totalCents: totals.get(previous.id) ?? 0 } : null,
    removedChapters: (before ?? [])
      .filter((c) => !codes.has(c.code))
      .map((c) => ({ code: c.code, name: c.name, totalCents: c.totalCents })),
    chapters: toBudgetChapters(chapters, before, totalCents, hitoOf),
  };
}

/** All revisions, newest first, and one of them in full (default: the newest). */
export async function getBudget(
  ctx: Ctx,
  projectId: string,
  revisionId?: string,
): Promise<ProjectBudget> {
  const [, rows, totals] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    db
      .select()
      .from(budgetRevisions)
      .where(and(eq(budgetRevisions.projectId, projectId), eq(budgetRevisions.tenantId, ctx.tenantId)))
      .orderBy(desc(budgetRevisions.number)),
    revisionTotals(projectId),
  ]);
  const index = revisionId ? rows.findIndex((r) => r.id === revisionId) : 0;
  if (index === -1) fail("not_found");
  const selected = rows[index];
  return {
    revisions: rows.map((r) => toSummary(r, totals.get(r.id) ?? 0)),
    revision: selected ? await revisionView(selected, rows[index + 1], totals) : null,
  };
}

// ─── Finding what a call acts on ─────────────────────────────────────────────
// Each check the project (to tell `project_not_found` from `not_found`) and
// the scoped row in parallel. `draft` requires a draft revision.

async function revisionInProject(ctx: Ctx, projectId: string, revisionId: string, { draft = true } = {}) {
  requireEditor(ctx);
  const [, revision] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    db.query.budgetRevisions.findFirst({
      where: and(
        eq(budgetRevisions.id, revisionId),
        eq(budgetRevisions.projectId, projectId),
        eq(budgetRevisions.tenantId, ctx.tenantId),
      ),
    }),
  ]);
  if (!revision) fail("not_found");
  if (draft && revision.status !== "draft") fail("not_draft");
  return revision;
}

async function chapterInProject(ctx: Ctx, projectId: string, chapterId: string) {
  requireEditor(ctx);
  const [, [row]] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    db
      .select({ chapter: budgetChapters, status: budgetRevisions.status })
      .from(budgetChapters)
      .innerJoin(budgetRevisions, eq(budgetRevisions.id, budgetChapters.revisionId))
      .where(
        and(
          eq(budgetChapters.id, chapterId),
          eq(budgetRevisions.projectId, projectId),
          eq(budgetRevisions.tenantId, ctx.tenantId),
        ),
      ),
  ]);
  if (!row) fail("not_found");
  if (row.status !== "draft") fail("not_draft");
  return row.chapter;
}

/** The given lines of the project's budget, with their revision's status. */
async function linesInProject(ctx: Ctx, projectId: string, ids: string[]) {
  requireEditor(ctx);
  const [, rows] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    db
      .select({
        id: budgetLines.id,
        status: budgetRevisions.status,
        revisionId: budgetRevisions.id,
      })
      .from(budgetLines)
      .innerJoin(budgetChapters, eq(budgetChapters.id, budgetLines.chapterId))
      .innerJoin(budgetRevisions, eq(budgetRevisions.id, budgetChapters.revisionId))
      .where(
        and(
          inArray(budgetLines.id, ids),
          eq(budgetRevisions.projectId, projectId),
          eq(budgetRevisions.tenantId, ctx.tenantId),
        ),
      ),
  ]);
  if (rows.length !== ids.length) fail("not_found");
  return rows;
}

async function draftLine(ctx: Ctx, projectId: string, lineId: string) {
  const [line] = await linesInProject(ctx, projectId, [lineId]);
  if (line!.status !== "draft") fail("not_draft");
}

// ─── Revisions ───────────────────────────────────────────────────────────────

/** Serialises revision creation within a project (the checks below read, then insert). */
async function lockProject(tx: Tx, projectId: string) {
  await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("update");
}

/**
 * Starts the project's budget: a draft revision (Rev.0, or `number` when an
 * existing budget is brought in at a later revision) and the standard hitos.
 * Body: { reference?, number? }
 */
export async function createBudget(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  await requireProject(ctx.tenantId, projectId);
  const reference = optionalText(input.reference, MAX_NAME);
  const number = input.number === undefined ? 0 : integer(input.number, 0, 999);

  return db.transaction(async (tx) => {
    await lockProject(tx, projectId);
    const existing = await tx.query.budgetRevisions.findFirst({
      where: eq(budgetRevisions.projectId, projectId),
      columns: { id: true },
    });
    if (existing) fail("budget_exists");
    const [revision] = await tx
      .insert(budgetRevisions)
      .values({ tenantId: ctx.tenantId, projectId, number, reference })
      .returning({ id: budgetRevisions.id });
    const hito = await tx.query.obraHitos.findFirst({
      where: eq(obraHitos.projectId, projectId),
      columns: { id: true },
    });
    if (!hito) await createDefaultHitos(tx, ctx.tenantId, projectId);
    return { revisionId: revision!.id };
  });
}

/** A new draft copied from the newest revision, progress included. */
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
    const [revision] = await tx
      .insert(budgetRevisions)
      .values({
        ...{ tenantId, projectId, reference, vatRateBp, builtAreaCm2, usefulAreaCm2, exclusions },
        number: newest.number + 1,
      })
      .returning({ id: budgetRevisions.id });
    const revisionId = revision!.id;

    const chapters = await tx.select().from(budgetChapters).where(eq(budgetChapters.revisionId, newest.id));
    if (chapters.length === 0) return { revisionId };
    const lines = await tx
      .select()
      .from(budgetLines)
      .where(
        inArray(
          budgetLines.chapterId,
          chapters.map((c) => c.id),
        ),
      );
    const newIds = new Map(chapters.map((c) => [c.id, crypto.randomUUID()]));
    // Notes explain changes against the revision before; the copy starts afresh.
    await tx
      .insert(budgetChapters)
      .values(chapters.map((c) => ({ ...c, id: newIds.get(c.id)!, revisionId, changeNote: null })));
    if (lines.length > 0) {
      await tx.insert(budgetLines).values(
        lines.map(({ id: _, updatedAt: __, ...line }) => ({
          ...line,
          chapterId: newIds.get(line.chapterId)!,
        })),
      );
    }
    return { revisionId };
  });
}

/** Body: { reference?, vatRateBp?, builtAreaM2?, usefulAreaM2?, exclusions? } — drafts only. */
export async function updateRevision(
  ctx: Ctx,
  projectId: string,
  revisionId: string,
  input: Record<string, unknown>,
) {
  await revisionInProject(ctx, projectId, revisionId);
  const area = (value: unknown) => (value === null ? null : scaled(value, MAX_AREA_M2, 100));
  const changes = pickChanges<typeof budgetRevisions.$inferInsert>(input, {
    reference: (v) => optionalText(v, MAX_NAME),
    vatRateBp: (v) => integer(v, 0, 10_000),
    exclusions: (v) => optionalText(v, 10_000),
  });
  // The API names the areas in m²; they're stored in hundredths.
  if ("builtAreaM2" in input) changes.builtAreaCm2 = area(input.builtAreaM2);
  if ("usefulAreaM2" in input) changes.usefulAreaCm2 = area(input.usefulAreaM2);
  if (Object.keys(changes).length > 0) {
    await db.update(budgetRevisions).set(changes).where(eq(budgetRevisions.id, revisionId));
  }
  return { revisionId };
}

/**
 * Makes a draft the contract. The revision it replaces is superseded, and the
 * progress recorded on it carries over to lines with the same codes.
 */
export async function acceptRevision(ctx: Ctx, projectId: string, revisionId: string) {
  await revisionInProject(ctx, projectId, revisionId);

  await db.transaction(async (tx) => {
    const [previous] = await tx
      .update(budgetRevisions)
      .set({ status: "superseded" })
      .where(and(eq(budgetRevisions.projectId, projectId), eq(budgetRevisions.status, "accepted")))
      .returning({ id: budgetRevisions.id });
    if (previous) {
      // Line by "chapter code / line code", from the old revision to the new.
      await tx.execute(sql`
        update ${budgetLines} as target
        set executed_pct = source.executed_pct
        from ${budgetLines} as source
        join ${budgetChapters} as source_chapter on source_chapter.id = source.chapter_id
        join ${budgetChapters} as target_chapter on target_chapter.code = source_chapter.code
        where source_chapter.revision_id = ${previous.id}
          and target_chapter.revision_id = ${revisionId}
          and target.chapter_id = target_chapter.id
          and target.code = source.code
      `);
    }
    await tx
      .update(budgetRevisions)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(eq(budgetRevisions.id, revisionId));
  });
  return { revisionId };
}

export async function deleteRevision(ctx: Ctx, projectId: string, revisionId: string) {
  await revisionInProject(ctx, projectId, revisionId);
  await db.delete(budgetRevisions).where(eq(budgetRevisions.id, revisionId));
  return { revisionId };
}

// ─── Chapters ────────────────────────────────────────────────────────────────

/** Runs a chapter write, turning a clash of codes within the revision into `duplicate_code`. */
async function withFreeCode<T>(write: () => Promise<T>): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueViolation(error, "budget_chapters_revision_code_unique")) fail("duplicate_code");
    throw error;
  }
}

/** Body: { code, name, changeNote? } */
export async function addChapter(
  ctx: Ctx,
  projectId: string,
  revisionId: string,
  input: Record<string, unknown>,
) {
  await revisionInProject(ctx, projectId, revisionId);
  const values = {
    code: requiredText(input.code, MAX_CHAPTER_CODE),
    name: requiredText(input.name, MAX_NAME),
    changeNote: optionalText(input.changeNote, MAX_NOTE),
  };
  const [chapter] = await withFreeCode(() =>
    db
      .insert(budgetChapters)
      .values({
        ...values,
        tenantId: ctx.tenantId,
        revisionId,
        position: nextPosition(budgetChapters, budgetChapters.position, eq(budgetChapters.revisionId, revisionId)),
      })
      .returning({ id: budgetChapters.id }),
  );
  return { chapterId: chapter!.id };
}

/** Body: { code?, name?, changeNote? } */
export async function updateChapter(
  ctx: Ctx,
  projectId: string,
  chapterId: string,
  input: Record<string, unknown>,
) {
  await chapterInProject(ctx, projectId, chapterId);
  const changes = pickChanges<typeof budgetChapters.$inferInsert>(input, {
    code: (v) => requiredText(v, MAX_CHAPTER_CODE),
    name: (v) => requiredText(v, MAX_NAME),
    changeNote: (v) => optionalText(v, MAX_NOTE),
  });
  if (Object.keys(changes).length > 0) {
    await withFreeCode(() =>
      db.update(budgetChapters).set(changes).where(eq(budgetChapters.id, chapterId)),
    );
  }
  return { chapterId };
}

export async function deleteChapter(ctx: Ctx, projectId: string, chapterId: string) {
  await chapterInProject(ctx, projectId, chapterId);
  await db.delete(budgetChapters).where(eq(budgetChapters.id, chapterId));
  return { chapterId };
}

// ─── Lines ───────────────────────────────────────────────────────────────────

const LINE_PARSERS = {
  code: (v: unknown) => requiredText(v, MAX_CHAPTER_CODE),
  description: (v: unknown) => requiredText(v, MAX_DESCRIPTION),
  unit: (v: unknown) => requiredText(v, MAX_UNIT),
  quantityMilli: (v: unknown) => scaled(v, MAX_QUANTITY, 1000),
  unitPriceCents: (v: unknown) =>
    v === undefined ? fail("missing_fields") : integer(v, 0, MAX_UNIT_PRICE_CENTS),
};

/** The API's `quantity` is stored in thousandths as `quantityMilli` (which the API never takes). */
const lineInput = ({ quantity, quantityMilli: _, ...input }: Record<string, unknown>) =>
  quantity === undefined ? input : { ...input, quantityMilli: quantity };

/** Body: { code, description, unit, quantity, unitPriceCents } */
export async function addLine(
  ctx: Ctx,
  projectId: string,
  chapterId: string,
  input: Record<string, unknown>,
) {
  await chapterInProject(ctx, projectId, chapterId);
  const fields = lineInput(input);
  const values = {
    code: LINE_PARSERS.code(fields.code),
    description: LINE_PARSERS.description(fields.description),
    unit: LINE_PARSERS.unit(fields.unit),
    quantityMilli: LINE_PARSERS.quantityMilli(fields.quantityMilli),
    unitPriceCents: LINE_PARSERS.unitPriceCents(fields.unitPriceCents),
  };
  const [line] = await db
    .insert(budgetLines)
    .values({
      ...values,
      tenantId: ctx.tenantId,
      chapterId,
      position: nextPosition(budgetLines, budgetLines.position, eq(budgetLines.chapterId, chapterId)),
    })
    .returning({ id: budgetLines.id });
  return { lineId: line!.id };
}

/** Body: any of { code, description, unit, quantity, unitPriceCents } — drafts only. */
export async function updateLine(
  ctx: Ctx,
  projectId: string,
  lineId: string,
  input: Record<string, unknown>,
) {
  await draftLine(ctx, projectId, lineId);
  const changes = pickChanges<typeof budgetLines.$inferInsert>(lineInput(input), LINE_PARSERS);
  if (Object.keys(changes).length > 0) {
    await db.update(budgetLines).set(changes).where(eq(budgetLines.id, lineId));
  }
  return { lineId };
}

export async function deleteLine(ctx: Ctx, projectId: string, lineId: string) {
  await draftLine(ctx, projectId, lineId);
  await db.delete(budgetLines).where(eq(budgetLines.id, lineId));
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
  return { updated: updates.size };
}
