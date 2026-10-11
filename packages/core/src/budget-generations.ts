import {
  aiUsage,
  and,
  budgetGenerations,
  db,
  desc,
  eq,
  gt,
  inArray,
  sql,
  tenants,
} from "@repo/db";
import { requireEditor, type Ctx } from "./context";
import {
  ACTIVE_GENERATION_STATUSES,
  BUDGET_QUALITIES,
  type BudgetFacts,
  type BudgetGeneration,
  type BudgetGenerationLogEntry,
  type BudgetQuality,
} from "./contract";
import { lockForFirstBudget } from "./budget-draft";
import { budgetInputs } from "./documents";
import { fail, integer, optionalText, requireProject } from "./obra-data";
import type { ProjectExtraction } from "./budget-ai/schemas";

// ─── Budget generations ───────────────────────────────────────────────────────
// A run of the AI that drafts a project's first budget (Rev.0) from its
// documents. Staff start it here; the work runs as a Vercel Workflow
// (apps/web/workflows/generate-budget.ts → budget-ai/pipeline.ts), which
// records its progress on the row. The portal polls it.
// ─────────────────────────────────────────────────────────────────────────────

export type GenerationRow = typeof budgetGenerations.$inferSelect;
export type GenerationOptions = { reference: string | null; quality: BudgetQuality; vatRateBp: number };

/**
 * What the portal shows of a run: its progress, and the few facts it read
 * (picked out in SQL; the row also holds the documents' text and every
 * answer of the AI, far too much to send every few seconds).
 */
const viewColumns = {
  id: budgetGenerations.id,
  status: budgetGenerations.status,
  step: budgetGenerations.step,
  log: budgetGenerations.log,
  error: budgetGenerations.error,
  revisionId: budgetGenerations.revisionId,
  createdAt: budgetGenerations.createdAt,
  datos: sql<ProjectExtraction["datos"] | null>`${budgetGenerations.extracted}->'datos'`,
  recuento: sql<ProjectExtraction["recuento"] | null>`${budgetGenerations.extracted}->'recuento'`,
  inconsistencies: sql<string[] | null>`jsonb_path_query_array(${budgetGenerations.extracted}, '$.incoherencias[*].titulo')`,
};
const selectView = () => db.select(viewColumns).from(budgetGenerations);
type ViewRow = Awaited<ReturnType<typeof selectView>>[number];

function toFacts({ datos, recuento, inconsistencies }: ViewRow): BudgetFacts | null {
  if (!datos || !recuento) return null;
  return {
    promoter: datos.cliente,
    site: [datos.ubicacion, datos.municipio].filter(Boolean).join(", "),
    architect: datos.arquitecto,
    typology: datos.tipologia,
    builtAreaM2: datos.m2c,
    usefulAreaM2: datos.m2u,
    windows: recuento.ventanas,
    bathrooms: recuento.banos + recuento.aseos,
    bedrooms: recuento.dormitorios,
    inconsistencies: inconsistencies ?? [],
  };
}

function toGeneration(row: ViewRow): BudgetGeneration {
  return {
    id: row.id,
    status: row.status,
    step: row.step,
    log: row.log as BudgetGenerationLogEntry[],
    error: row.error,
    revisionId: row.revisionId,
    facts: toFacts(row),
    createdAt: row.createdAt.toISOString(),
  };
}

export async function getLatestGeneration(tenantId: string, projectId: string): Promise<BudgetGeneration | null> {
  const [row] = await selectView()
    .where(and(eq(budgetGenerations.projectId, projectId), eq(budgetGenerations.tenantId, tenantId)))
    .orderBy(desc(budgetGenerations.createdAt))
    .limit(1);
  return row ? toGeneration(row) : null;
}

async function generationInProject(ctx: Ctx, projectId: string, generationId: string) {
  const [, [row]] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    selectView().where(
        and(
          eq(budgetGenerations.id, generationId),
          eq(budgetGenerations.projectId, projectId),
          eq(budgetGenerations.tenantId, ctx.tenantId),
        ),
      ),
  ]);
  if (!row) fail("not_found");
  return row;
}

export async function getGeneration(ctx: Ctx, projectId: string, generationId: string) {
  return toGeneration(await generationInProject(ctx, projectId, generationId));
}

/** This month's AI spend of the tenant, in US cents. */
async function monthSpendCents(tenantId: string) {
  const [row] = await db
    .select({ micro: sql<string>`coalesce(sum(${aiUsage.costMicroUsd}), 0)` })
    .from(aiUsage)
    .where(and(eq(aiUsage.tenantId, tenantId), gt(aiUsage.createdAt, sql`date_trunc('month', now())`)));
  return Number(row?.micro ?? 0) / 10_000;
}

/**
 * Queues a run over the project's budget documents (the ones uploaded on the
 * Budget tab, `budget_input` set). Only before the project has a budget, one
 * run at a time, and within the tenant's monthly AI limit. The caller starts
 * the workflow and records its id (`setWorkflowRun`).
 * Body: { documentIds, reference?, quality?, vatRateBp? }
 */
export async function startGeneration(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  await requireProject(ctx.tenantId, projectId);
  if (!Array.isArray(input.documentIds) || input.documentIds.length === 0) fail("no_documents");
  if (input.documentIds.some((id) => typeof id !== "string")) fail("invalid_input");
  const documentIds = [...new Set(input.documentIds as string[])];
  const options: GenerationOptions = {
    reference: optionalText(input.reference, 200),
    quality: input.quality === undefined ? "framer" : (BUDGET_QUALITIES.find((q) => q === input.quality) ?? fail("invalid_input")),
    vatRateBp: input.vatRateBp === undefined ? 1000 : integer(input.vatRateBp, 0, 10_000),
  };

  const docs = await budgetInputs(ctx.tenantId, projectId, documentIds);
  if (docs.length !== documentIds.length) fail("not_found");

  const tenant = await db.query.tenants.findFirst({
    where: eq(tenants.id, ctx.tenantId),
    columns: { aiMonthlyLimitCents: true },
  });
  if (tenant?.aiMonthlyLimitCents != null && (await monthSpendCents(ctx.tenantId)) >= tenant.aiMonthlyLimitCents) {
    fail("ai_limit_reached");
  }

  return db.transaction(async (tx) => {
    // Serialises starts within the project, like revision creation.
    await lockForFirstBudget(tx, projectId);
    const running = await tx.query.budgetGenerations.findFirst({
      where: and(eq(budgetGenerations.projectId, projectId), inArray(budgetGenerations.status, ACTIVE_GENERATION_STATUSES)),
      columns: { id: true },
    });
    if (running) fail("generation_running");
    const [row] = await tx
      .insert(budgetGenerations)
      .values({
        tenantId: ctx.tenantId,
        projectId,
        status: "queued",
        options,
        documentIds,
        createdById: ctx.userId,
      })
      .returning({ id: budgetGenerations.id });
    return { generationId: row!.id };
  });
}

/** Records the workflow run carrying a generation (to cancel it later). */
export async function setWorkflowRun(generationId: string, workflowRunId: string) {
  await db.update(budgetGenerations).set({ workflowRunId }).where(eq(budgetGenerations.id, generationId));
}

/** Stops a queued or running generation; returns the workflow run to cancel, if any. */
export async function cancelGeneration(ctx: Ctx, projectId: string, generationId: string) {
  requireEditor(ctx);
  await generationInProject(ctx, projectId, generationId);
  const [row] = await db
    .update(budgetGenerations)
    .set({ status: "cancelled" })
    .where(and(eq(budgetGenerations.id, generationId), inArray(budgetGenerations.status, ACTIVE_GENERATION_STATUSES)))
    .returning({ workflowRunId: budgetGenerations.workflowRunId });
  return { generationId, workflowRunId: row?.workflowRunId ?? null };
}
