import { and, asc, budgetExclusionPresets as presets, count, db, eq, isNull } from "@repo/db";
import { DEFAULT_EXCLUSIONS } from "./budget-template";
import { requireEditor, type Ctx } from "./context";
import { MAX_EXCLUSION_PRESETS, type ExclusionPreset } from "./contract";
import { exclusionPresetSchema } from "./inputs/budget-exclusions";
import { parse } from "./inputs/fields";
import { fail, nextPosition } from "./obra-data";
import { isUniqueViolation } from "./pg-errors";
import { softDeleted, type Tx } from "./project-client";

// ─── The library of "Gastos no incluidos" ────────────────────────────────────
// The tenant's standard lines a budget may exclude (a geotechnical study, the
// licence, furniture…), shown as a checklist on every draft's Condiciones
// page. Ticking one copies its text into the budget (`texts.exclusions`, the
// one list the PDF prints and a copied revision takes along: ./budget ›
// updateRevision's `exclusion`), so editing or deleting a line here never
// changes a budget, issued or not: an edited line shows on a draft that had
// the old text as one of the budget's own lines.
//
// A tenant starts from the template's lines (DEFAULT_EXCLUSIONS), written the
// first time its library is read; from then on it is the tenant's to change,
// a template line too. A deleted line keeps its row (soft delete, like every
// delete on the platform) and is left out of every read; adding the same text
// again makes a new line. Any staff role reads it; admins and managers write.
// Web-only: the client's app never shows it.
// ─────────────────────────────────────────────────────────────────────────────

const PRESET = { id: presets.id, label: presets.label };
const UNIQUE_LABEL = "budget_exclusion_presets_tenant_label_unique";

type Db = Tx | typeof db;

/** The tenant's lines not deleted. */
const live = (tenantId: string) => and(eq(presets.tenantId, tenantId), isNull(presets.deletedAt));

const readLibrary = (tenantId: string, tx: Db) =>
  tx.select(PRESET).from(presets).where(live(tenantId)).orderBy(asc(presets.position), asc(presets.createdAt), asc(presets.id));

/**
 * The tenant's library in its order (`tx`: within a write). Empty, and never
 * had a line (a deleted one counts): the template's lines are written first.
 */
export async function libraryOf(tenantId: string, tx: Db = db): Promise<ExclusionPreset[]> {
  const library = await readLibrary(tenantId, tx);
  if (library.length > 0) return library;
  // soft-delete-ok(budgetExclusionPresets): a deleted line still means the tenant has had a library.
  const [any] = await tx.select({ id: presets.id }).from(presets).where(eq(presets.tenantId, tenantId)).limit(1);
  if (any) return library;
  // Two first reads at once: the second one's lines are the same texts, which the unique index turns away.
  await tx
    .insert(presets)
    .values(DEFAULT_EXCLUSIONS.map((label, position) => ({ tenantId, label, position })))
    .onConflictDoNothing();
  return readLibrary(tenantId, tx);
}

/** GET /api/v1/budgets/exclusions: the tenant's library, in its order. Any staff role. */
export function listExclusionPresets(ctx: Ctx): Promise<ExclusionPreset[]> {
  return libraryOf(ctx.tenantId);
}

/**
 * `label` in the library: the line that already says it, else a new one,
 * last. Full (MAX_EXCLUSION_PRESETS): `exclusion_library_full`. Called by
 * `createExclusionPreset` and by a draft's "Guardar para otros proyectos"
 * (`tx`: within the draft's write).
 */
export async function addToLibrary(ctx: Ctx, label: string, tx: Db = db): Promise<ExclusionPreset> {
  const library = await libraryOf(ctx.tenantId, tx);
  const existing = library.find((preset) => preset.label === label);
  if (existing) return existing;
  if (library.length >= MAX_EXCLUSION_PRESETS) fail("exclusion_library_full");
  const [created] = await tx
    .insert(presets)
    .values({ tenantId: ctx.tenantId, label, position: nextPosition(presets, presets.position, live(ctx.tenantId)), createdById: ctx.userId })
    .onConflictDoNothing()
    .returning(PRESET);
  if (created) return created;
  // Added meanwhile by someone else: theirs.
  const [added] = await tx.select(PRESET).from(presets).where(and(live(ctx.tenantId), eq(presets.label, label)));
  return added!;
}

/** POST /api/v1/budgets/exclusions — body { label } → the line (the existing one if the text is there already). Admins and managers. */
export async function createExclusionPreset(ctx: Ctx, input: Record<string, unknown>): Promise<ExclusionPreset> {
  requireEditor(ctx);
  const { label } = parse(exclusionPresetSchema, input);
  return addToLibrary(ctx, label);
}

/** PATCH /api/v1/budgets/exclusions/:id — body { label }. Another line saying it: `exclusion_exists`. Budgets keep their text. Admins and managers. */
export async function updateExclusionPreset(ctx: Ctx, presetId: string, input: Record<string, unknown>): Promise<ExclusionPreset> {
  requireEditor(ctx);
  // A line that isn't there is a 404 before a bad label's 400.
  const [found] = await db.select({ lines: count() }).from(presets).where(and(eq(presets.id, presetId), live(ctx.tenantId)));
  if (!found?.lines) fail("not_found");
  const { label } = parse(exclusionPresetSchema, input);
  try {
    const [updated] = await db
      .update(presets)
      .set({ label })
      .where(and(eq(presets.id, presetId), live(ctx.tenantId)))
      .returning(PRESET);
    // Deleted meanwhile.
    if (!updated) fail("not_found");
    return updated;
  } catch (err) {
    if (isUniqueViolation(err, UNIQUE_LABEL)) fail("exclusion_exists");
    throw err;
  }
}

/** DELETE /api/v1/budgets/exclusions/:id: out of the library (soft); budgets that ticked it keep the line. Admins and managers. */
export async function deleteExclusionPreset(ctx: Ctx, presetId: string): Promise<{ id: string }> {
  requireEditor(ctx);
  const [deleted] = await db
    .update(presets)
    .set(softDeleted(ctx))
    .where(and(eq(presets.id, presetId), live(ctx.tenantId)))
    .returning({ id: presets.id });
  if (!deleted) fail("not_found");
  return deleted;
}
