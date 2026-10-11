import { and, budgetChapters, budgetLines, budgetRevisions, eq, obraHitoChapters, sql, type AnyColumn } from "@repo/db";
import { chapterInProject, draftLine, inDraft, revisionInProject } from "./budget-draft";
import { deleteChapter, withFreeCode } from "./budget";
import type { Ctx } from "./context";
import { BUDGET_MODEL, MAX_CHAPTER_CODE, OPTION_KINDS, type OptionKind } from "./contract";
import { fail, nextPosition, optionalText, pickChanges, requiredText } from "./obra-data";
import { priceBaseItem } from "./price-base";
import type { Tx } from "./project-client";

// ─── Budget options ───────────────────────────────────────────────────────────
// Items priced apart, below the twenty chapters: extras the client may add
// (a pool), alternatives (PVC instead of wood windows) and deductions (lines
// the owner does themselves). Their lines are numbered OP.01, OP.02… across
// all options (budget-draft.ts keeps the numbers in order). The client
// chooses on acceptance; the chosen ones join the contract.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_NAME = 200;
const MAX_NOTE = 2_000;

const optionKind = (value: unknown): OptionKind => OPTION_KINDS.find((k) => k === value) ?? fail("invalid_input");

/**
 * The next option code: OP1, OP2… past every code an option of the project
 * has had in any revision, or a hito is mapped to, so a deleted option's code
 * (and the hito closing it) never passes to a new one.
 */
async function nextOptionCode(tx: Tx, revisionId: string) {
  const [revision] = await tx
    .select({ projectId: budgetRevisions.projectId })
    .from(budgetRevisions)
    .where(eq(budgetRevisions.id, revisionId));
  const projectId = revision?.projectId ?? "";
  const highest = (code: AnyColumn) => ({
    n: sql<number>`coalesce(max(substring(${code} from 3)::int), 0)`.mapWith(Number),
  });
  const [[options], [mapped]] = await Promise.all([
    tx
      .select(highest(budgetChapters.code))
      .from(budgetChapters)
      .innerJoin(budgetRevisions, eq(budgetRevisions.id, budgetChapters.revisionId))
      .where(and(eq(budgetRevisions.projectId, projectId), eq(budgetChapters.kind, "option"))),
    tx
      .select(highest(obraHitoChapters.chapterCode))
      .from(obraHitoChapters)
      .where(and(eq(obraHitoChapters.projectId, projectId), sql`${obraHitoChapters.chapterCode} ~ '^OP[0-9]+$'`)),
  ]);
  return `OP${Math.max(options?.n ?? 0, mapped?.n ?? 0) + 1}`;
}

type NewOption = {
  name: string;
  optionKind: OptionKind;
  pdfNote: string | null;
  replacesLine: string | null;
};

async function insertOption(tx: Tx, tenantId: string, revisionId: string, values: NewOption) {
  const [option] = await tx
    .insert(budgetChapters)
    .values({
      ...values,
      tenantId,
      revisionId,
      kind: "option",
      code: await nextOptionCode(tx, revisionId),
      position: nextPosition(
        budgetChapters,
        budgetChapters.position,
        and(eq(budgetChapters.revisionId, revisionId), eq(budgetChapters.kind, "option")),
      ),
    })
    .returning({ id: budgetChapters.id });
  return option!.id;
}

/** A FRAMER draft: options exist only in the FRAMER model. */
async function framerDraft(ctx: Ctx, projectId: string, revisionId: string) {
  const revision = await revisionInProject(ctx, projectId, revisionId);
  if (revision.model !== BUDGET_MODEL) fail("fixed_chapters");
  return revision;
}

/**
 * Body: { name, optionKind, intro?, replacesLine?, baseCode? }. With a price
 * base `baseCode`, the option starts with that entry as its line (quantity 1)
 * and is named after it unless `name` is given.
 */
export async function addOption(ctx: Ctx, projectId: string, revisionId: string, input: Record<string, unknown>) {
  await framerDraft(ctx, projectId, revisionId);
  const base = input.baseCode === undefined ? null : (priceBaseItem(String(input.baseCode)) ?? fail("invalid_input"));
  const values = {
    name: requiredText(input.name ?? base?.description.slice(0, MAX_NAME), MAX_NAME),
    optionKind: optionKind(input.optionKind ?? "extra"),
    pdfNote: optionalText(input.intro, MAX_NOTE),
    replacesLine: optionalText(input.replacesLine, MAX_CHAPTER_CODE),
  };
  const optionId = await withFreeCode(() =>
    inDraft(revisionId, async (tx) => {
      const id = await insertOption(tx, ctx.tenantId, revisionId, values);
      if (base) {
        const { code: baseCode, description, unit, unitPriceCents } = base;
        await tx
          .insert(budgetLines)
          .values({ tenantId: ctx.tenantId, chapterId: id, code: "OP.00", description, unit, unitPriceCents, quantityMilli: 1000, source: "base", baseCode, position: 0 });
      }
      return id;
    }),
  );
  return { optionId };
}

/** Body: any of { name, optionKind, intro, replacesLine } */
export async function updateOption(ctx: Ctx, projectId: string, optionId: string, input: Record<string, unknown>) {
  const option = await chapterInProject(ctx, projectId, optionId);
  if (option.kind !== "option") fail("not_found");
  const changes = pickChanges<typeof budgetChapters.$inferInsert>(
    { ...input, ...("intro" in input ? { pdfNote: input.intro } : {}) },
    {
      name: (v) => requiredText(v, MAX_NAME),
      optionKind: (v) => optionKind(v),
      pdfNote: (v) => optionalText(v, MAX_NOTE),
      replacesLine: (v) => optionalText(v, MAX_CHAPTER_CODE),
    },
  );
  if (Object.keys(changes).length > 0) {
    // Names and texts: neither the numbering nor chapter 20 moves.
    await inDraft(option.revisionId, (tx) => tx.update(budgetChapters).set(changes).where(eq(budgetChapters.id, optionId)), {
      sync: false,
    });
  }
  return { optionId };
}

export async function deleteOption(ctx: Ctx, projectId: string, optionId: string) {
  const option = await chapterInProject(ctx, projectId, optionId);
  if (option.kind !== "option") fail("not_found");
  await deleteChapter(ctx, projectId, optionId);
  return { optionId };
}

/**
 * Offers a chapter line as an option:
 * - `deduction`: the owner does it themselves. The line joins the draft's
 *   deduction option ("La Propiedad ejecuta", created if needed) at minus its price.
 * - `alternative`: a new option that swaps the line for another solution. It
 *   starts with the replacement (same quantity and price, for staff to edit)
 *   and the original at minus its price, so its total is the difference.
 * Body: { kind: "deduction" | "alternative" }
 */
export async function optionFromLine(ctx: Ctx, projectId: string, lineId: string, input: Record<string, unknown>) {
  const kind = input.kind === "deduction" || input.kind === "alternative" ? input.kind : fail("invalid_input");
  const row = await draftLine(ctx, projectId, lineId);
  if (row.chapterKind !== "chapter" || row.line.source === "computed") fail("invalid_input");
  const { line } = row;
  const copy = { tenantId: ctx.tenantId, unit: line.unit, quantityMilli: line.quantityMilli, code: "OP.00" };
  const minus = { ...copy, description: line.description, unitPriceCents: -line.unitPriceCents, baseCode: line.baseCode };

  const optionId = await inDraft(row.revisionId, async (tx) => {
    let id: string;
    if (kind === "deduction") {
      const [existing] = await tx
        .select({ id: budgetChapters.id })
        .from(budgetChapters)
        .where(
          and(
            eq(budgetChapters.revisionId, row.revisionId),
            eq(budgetChapters.kind, "option"),
            eq(budgetChapters.optionKind, "deduction"),
          ),
        )
        .limit(1);
      id =
        existing?.id ??
        (await insertOption(tx, ctx.tenantId, row.revisionId, {
          name: "La Propiedad ejecuta",
          optionKind: "deduction",
          pdfNote: "Partidas incluidas en el presupuesto que el promotor puede ejecutar por su cuenta; se descuentan del precio si las elige.",
          replacesLine: null,
        }));
      await tx.insert(budgetLines).values({
        ...minus,
        chapterId: id,
        note: `Deducción de la partida ${line.code}`,
        position: nextPosition(budgetLines, budgetLines.position, eq(budgetLines.chapterId, id)),
      });
    } else {
      id = await insertOption(tx, ctx.tenantId, row.revisionId, {
        name: `Alternativa a la partida ${line.code}`,
        optionKind: "alternative",
        pdfNote: null,
        replacesLine: line.code,
      });
      await tx.insert(budgetLines).values([
        { ...copy, description: line.description, unitPriceCents: line.unitPriceCents, chapterId: id, position: 0 },
        { ...minus, chapterId: id, note: `Sustituye a la partida ${line.code}`, position: 1 },
      ]);
    }
    return id;
  });
  return { optionId };
}
