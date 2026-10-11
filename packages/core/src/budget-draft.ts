import {
  and,
  budgetChapters,
  budgetLines,
  budgetRevisions,
  db,
  eq,
  inArray,
  projects,
  sql,
} from "@repo/db";
import { requireEditor, type Ctx } from "./context";
import { BUDGET_MODEL, CONTINGENCY_CHAPTER, CONTINGENCY_LINE } from "./contract";
import { contingencyDescription } from "./budget-template";
import { ofBp } from "./obra-calc";
import { fail, linesTotalSql, requireProject, type RevisionRow } from "./obra-data";
import type { Tx } from "./project-client";

// ─── Budget: finding what a call acts on, and writing to drafts ───────────────
// Shared by the budget services (budget.ts, budget-options.ts, budget-issue.ts).
// Each lookup checks the project (to tell `project_not_found` from
// `not_found`) and the scoped row in parallel.
// ─────────────────────────────────────────────────────────────────────────────

export async function revisionInProject(
  ctx: Ctx,
  projectId: string,
  revisionId: string,
  { draft = true } = {},
): Promise<RevisionRow> {
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

/** A chapter (or option) of a draft revision, with its revision's model. */
export async function chapterInProject(ctx: Ctx, projectId: string, chapterId: string) {
  requireEditor(ctx);
  const [, [row]] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    db
      .select({ chapter: budgetChapters, status: budgetRevisions.status, model: budgetRevisions.model })
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
  return { ...row.chapter, model: row.model };
}

/** The given lines of the project's budget, with their chapter and revision. */
export async function linesInProject(ctx: Ctx, projectId: string, ids: string[]) {
  requireEditor(ctx);
  const [, rows] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    db
      .select({
        line: budgetLines,
        status: budgetRevisions.status,
        revisionId: budgetRevisions.id,
        chapterCode: budgetChapters.code,
        chapterKind: budgetChapters.kind,
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

/** A line of a draft revision. */
export async function draftLine(ctx: Ctx, projectId: string, lineId: string) {
  const [row] = await linesInProject(ctx, projectId, [lineId]);
  if (row!.status !== "draft") fail("not_draft");
  return row!;
}

/** Serialises revision creation within a project (the checks read, then insert). */
export async function lockProject(tx: Tx, projectId: string) {
  await tx.select({ id: projects.id }).from(projects).where(eq(projects.id, projectId)).for("update");
}

/** Locks the project for its first budget: `budget_exists` if it has one. */
export async function lockForFirstBudget(tx: Tx, projectId: string) {
  await lockProject(tx, projectId);
  const existing = await tx.query.budgetRevisions.findFirst({
    where: eq(budgetRevisions.projectId, projectId),
    columns: { id: true },
  });
  if (existing) fail("budget_exists");
}

type DraftRow = { tenantId: string; contingencyBp: number };

/**
 * Runs a write to a draft revision holding the revision's row lock, rechecking
 * it is still a draft: the checks above read outside it, so without the lock
 * an edit racing an issue or an acceptance could change what was sent. In the
 * FRAMER model, chapter 20 and the option numbers are then brought up to date
 * in the same transaction, unless the write can't change them (`sync: false`:
 * texts, names, notes).
 */
export async function inDraft<T>(
  revisionId: string,
  write: (tx: Tx) => Promise<T>,
  { sync = true } = {},
): Promise<T> {
  return db.transaction(async (tx) => {
    const [revision] = await tx
      .select({
        status: budgetRevisions.status,
        model: budgetRevisions.model,
        tenantId: budgetRevisions.tenantId,
        contingencyBp: budgetRevisions.contingencyBp,
      })
      .from(budgetRevisions)
      .where(eq(budgetRevisions.id, revisionId))
      .for("update");
    if (!revision) fail("not_found");
    if (revision.status !== "draft") fail("not_draft");
    const result = await write(tx);
    if (sync && revision.model === BUDGET_MODEL) {
      // The write may have changed the percentage itself.
      const [{ contingencyBp }] = (await tx
        .select({ contingencyBp: budgetRevisions.contingencyBp })
        .from(budgetRevisions)
        .where(eq(budgetRevisions.id, revisionId))) as [{ contingencyBp: number }];
      await syncDraft(tx, revisionId, { tenantId: revision.tenantId, contingencyBp });
    }
    return result;
  });
}

/**
 * Chapter 20 is one line worth `contingency_bp` of chapters 01–19 (each line
 * rounded as everywhere else); option lines are numbered OP.01, OP.02… in
 * order across all options.
 */
export async function syncDraft(tx: Tx, revisionId: string, { tenantId, contingencyBp }: DraftRow) {
  const [contingency] = await tx
    .select({ id: budgetChapters.id })
    .from(budgetChapters)
    .where(
      and(
        eq(budgetChapters.revisionId, revisionId),
        eq(budgetChapters.kind, "chapter"),
        eq(budgetChapters.code, CONTINGENCY_CHAPTER),
      ),
    );
  if (contingency) {
    const [{ base } = { base: "0" }] = await tx
      .select({ base: linesTotalSql() })
      .from(budgetLines)
      .innerJoin(budgetChapters, eq(budgetChapters.id, budgetLines.chapterId))
      .where(
        and(
          eq(budgetChapters.revisionId, revisionId),
          eq(budgetChapters.kind, "chapter"),
          sql`${budgetChapters.code} <> ${CONTINGENCY_CHAPTER}`,
        ),
      );
    const values = {
      code: CONTINGENCY_LINE,
      description: contingencyDescription(contingencyBp),
      unit: "pa",
      quantityMilli: 1000,
      unitPriceCents: ofBp(Number(base), contingencyBp),
      source: "computed" as const,
    };
    const updated = await tx
      .update(budgetLines)
      .set(values)
      .where(and(eq(budgetLines.chapterId, contingency.id), eq(budgetLines.source, "computed")))
      .returning({ id: budgetLines.id });
    if (updated.length === 0) {
      await tx.insert(budgetLines).values({ ...values, tenantId, chapterId: contingency.id, position: 0 });
    }
  }
  await tx.execute(sql`
    update ${budgetLines} as target
    set code = numbered.code
    from (
      select line.id, 'OP.' || lpad((row_number() over (order by chapter.position, line.position))::text, 2, '0') as code
      from ${budgetLines} as line
      join ${budgetChapters} as chapter on chapter.id = line.chapter_id
      where chapter.revision_id = ${revisionId} and chapter.kind = 'option'
    ) as numbered
    where target.id = numbered.id and target.code <> numbered.code
  `);
}

/**
 * A free code in a chapter: `preferred` (a price base code) if no line has
 * it, else one past the highest "05.NN", so a new or duplicated line never
 * repeats a code.
 */
export async function nextLineCode(tx: Tx, chapterId: string, chapterCode: string, preferred?: string) {
  const rows = await tx.select({ code: budgetLines.code }).from(budgetLines).where(eq(budgetLines.chapterId, chapterId));
  if (preferred && !rows.some((r) => r.code === preferred)) return preferred;
  const prefix = `${chapterCode}.`;
  const highest = Math.max(
    0,
    ...rows.map((r) => (r.code.startsWith(prefix) ? Number(r.code.slice(prefix.length)) : 0)).filter(Number.isInteger),
  );
  return `${prefix}${String(highest + 1).padStart(2, "0")}`;
}
