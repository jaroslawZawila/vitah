import {
  and,
  budgetChapters,
  budgetRevisions,
  db,
  eq,
  inArray,
  obraHitoChapters,
  obraHitoChecks,
  obraHitoPhotos,
  obraHitos,
  or,
  projectPhotos,
} from "@repo/db";
import { requireEditor, type Ctx } from "./context";
import { MAX_CHAPTER_CODE, MAX_DOCUMENT_BYTES, type Hito, type HitoFileKind } from "./contract";
import {
  calendarDate,
  clientProject,
  fail,
  integer,
  loadObra,
  nextPosition,
  optionalText,
  pickChanges,
  requireProject,
  requiredText,
  type HitoRow,
} from "./obra-data";
import { todayInSpain } from "./obra-calc";
import { HITO_TEMPLATE } from "./obra-template";
import {
  isPdf,
  openStoredFile,
  projectFolder,
  removeFiles,
  storeFiles,
} from "./project-files";
import type { Tx } from "./project-client";
import { deleteFile } from "./storage";

// ─── Payment hitos (H0–H9) ───────────────────────────────────────────────────
// The project's payment plan. Each hito closes some budget chapters; once they
// are built and its checks are done, the acta fotográfica de conformidad is
// signed on paper and staff upload it, then the invoice, then record the
// payment (PROCESS.md §3.6, §8.4).
// ─────────────────────────────────────────────────────────────────────────────

const MAX_NAME = 120;
const MAX_TEXT = 2_000;
const MAX_CHECK = 300;

/** The standard plan (./obra-template), for a project that has none yet. */
export async function createDefaultHitos(tx: Tx, tenantId: string, projectId: string) {
  const rows = await tx
    .insert(obraHitos)
    .values(
      HITO_TEMPLATE.map(({ code, name, pctBp, scope, billingMoment }, position) => ({
        tenantId,
        projectId,
        code,
        name,
        pctBp,
        scope,
        billingMoment,
        position,
      })),
    )
    .returning({ id: obraHitos.id, code: obraHitos.code });
  const idOf = new Map(rows.map((r) => [r.code, r.id]));
  const chapters = HITO_TEMPLATE.flatMap((h) =>
    h.chapterCodes.map((chapterCode) => ({
      hitoId: idOf.get(h.code)!,
      tenantId,
      projectId,
      chapterCode,
    })),
  );
  const checks = HITO_TEMPLATE.flatMap((h) =>
    h.checks.map((label, position) => ({ hitoId: idOf.get(h.code)!, tenantId, label, position })),
  );
  if (chapters.length > 0) await tx.insert(obraHitoChapters).values(chapters);
  if (checks.length > 0) await tx.insert(obraHitoChecks).values(checks);
}

// ─── Reading ─────────────────────────────────────────────────────────────────

export async function listHitos(ctx: Ctx, projectId: string): Promise<Hito[]> {
  const [, { hitos }] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    loadObra(ctx.tenantId, projectId),
  ]);
  return hitos;
}

/** One hito of the project, priced and with its progress. */
export async function getHito(ctx: Ctx, projectId: string, hitoId: string): Promise<Hito> {
  const hito = (await listHitos(ctx, projectId)).find((h) => h.id === hitoId);
  if (!hito) fail("not_found");
  return hito;
}

/** The hito, if it is the project's (checking the project too, in parallel). */
async function findHito(ctx: Ctx, projectId: string, hitoId: string) {
  const [, hito] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    db.query.obraHitos.findFirst({
      where: and(
        eq(obraHitos.id, hitoId),
        eq(obraHitos.projectId, projectId),
        eq(obraHitos.tenantId, ctx.tenantId),
      ),
    }),
  ]);
  return hito;
}

async function hitoInProject(ctx: Ctx, projectId: string, hitoId: string): Promise<HitoRow> {
  requireEditor(ctx);
  const hito = await findHito(ctx, projectId, hitoId);
  if (!hito) fail("not_found");
  return hito;
}

const touch = (hitoId: string, changes: Partial<typeof obraHitos.$inferInsert>) =>
  db.update(obraHitos).set(changes).where(eq(obraHitos.id, hitoId));

// ─── The plan ────────────────────────────────────────────────────────────────

type PlanChange = {
  hitoId: string;
  changes: Partial<typeof obraHitos.$inferInsert>;
  /** Null when the chapters don't change. */
  chapterCodes: string[] | null;
};

/** Validates one hito's changes: any of { name, pctBp, scope, billingMoment, chapterCodes }. */
function parseChange(hitoId: string, input: Record<string, unknown>): PlanChange {
  const changes = pickChanges<typeof obraHitos.$inferInsert>(input, {
    name: (v) => requiredText(v, MAX_NAME),
    pctBp: (v) => integer(v, 0, 10_000),
    scope: (v) => optionalText(v, MAX_TEXT) ?? "",
    billingMoment: (v) => optionalText(v, MAX_TEXT) ?? "",
  });
  let chapterCodes: string[] | null = null;
  if ("chapterCodes" in input) {
    if (!Array.isArray(input.chapterCodes)) fail("invalid_input");
    const codes = (input.chapterCodes as unknown[]).map((code) => requiredText(code, MAX_CHAPTER_CODE));
    chapterCodes = [...new Set(codes)];
  }
  return { hitoId, changes, chapterCodes };
}

/**
 * Applies validated changes to the project's hitos in one transaction, in
 * order. Chapters given to a hito move from whichever hito had them.
 */
async function applyPlan(ctx: Ctx, projectId: string, plan: PlanChange[]) {
  const codes = plan.flatMap((p) => p.chapterCodes ?? []);
  if (codes.length > 0) {
    // Any revision's chapters: the plan may be set before one is accepted.
    const known = await db
      .selectDistinct({ code: budgetChapters.code })
      .from(budgetChapters)
      .innerJoin(budgetRevisions, eq(budgetRevisions.id, budgetChapters.revisionId))
      .where(
        and(
          eq(budgetRevisions.projectId, projectId),
          eq(budgetRevisions.tenantId, ctx.tenantId),
          inArray(budgetChapters.code, codes),
        ),
      );
    if (known.length !== new Set(codes).size) fail("unknown_chapter");
  }
  await db.transaction(async (tx) => {
    for (const { hitoId, changes, chapterCodes } of plan) {
      if (Object.keys(changes).length > 0) {
        await tx.update(obraHitos).set(changes).where(eq(obraHitos.id, hitoId));
      }
      if (chapterCodes === null) continue;
      // Its old chapters, and these codes from whichever hito had them.
      await tx
        .delete(obraHitoChapters)
        .where(
          or(
            eq(obraHitoChapters.hitoId, hitoId),
            chapterCodes.length > 0
              ? and(
                  eq(obraHitoChapters.projectId, projectId),
                  inArray(obraHitoChapters.chapterCode, chapterCodes),
                )
              : undefined,
          ),
        );
      if (chapterCodes.length === 0) continue;
      await tx.insert(obraHitoChapters).values(
        chapterCodes.map((chapterCode) => ({ hitoId, tenantId: ctx.tenantId, projectId, chapterCode })),
      );
    }
  });
}

/** Body: any of { name, pctBp, scope, billingMoment, chapterCodes }. */
export async function updateHito(
  ctx: Ctx,
  projectId: string,
  hitoId: string,
  input: Record<string, unknown>,
) {
  await hitoInProject(ctx, projectId, hitoId);
  await applyPlan(ctx, projectId, [parseChange(hitoId, input)]);
  return { hitoId };
}

/**
 * Several hitos at once, all or nothing (the Payments tab's plan editor).
 * Body: { hitos: [{ id, name?, pctBp?, scope?, billingMoment?, chapterCodes? }] }
 */
export async function updatePlan(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  if (!Array.isArray(input.hitos)) fail("missing_fields");
  const plan = (input.hitos as unknown[]).map((entry) => {
    const { id, ...fields } = (entry ?? {}) as Record<string, unknown>;
    if (typeof id !== "string") fail("invalid_input");
    return parseChange(id, fields);
  });
  const ids = [...new Set(plan.map((p) => p.hitoId))];
  const [, found] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    ids.length > 0
      ? db
          .select({ id: obraHitos.id })
          .from(obraHitos)
          .where(
            and(
              inArray(obraHitos.id, ids),
              eq(obraHitos.projectId, projectId),
              eq(obraHitos.tenantId, ctx.tenantId),
            ),
          )
      : [],
  ]);
  if (found.length !== ids.length) fail("not_found");
  await applyPlan(ctx, projectId, plan);
  return { updated: plan.length };
}

// ─── Checks ──────────────────────────────────────────────────────────────────

/** Body: { label } */
export async function addCheck(
  ctx: Ctx,
  projectId: string,
  hitoId: string,
  input: Record<string, unknown>,
) {
  await hitoInProject(ctx, projectId, hitoId);
  const label = requiredText(input.label, MAX_CHECK);
  const [check] = await db
    .insert(obraHitoChecks)
    .values({
      tenantId: ctx.tenantId,
      hitoId,
      label,
      position: nextPosition(obraHitoChecks, obraHitoChecks.position, eq(obraHitoChecks.hitoId, hitoId)),
    })
    .returning({ id: obraHitoChecks.id });
  return { checkId: check!.id };
}

/** The check, if it is the project's (and `hitoId`'s, when given). */
async function checkInProject(ctx: Ctx, projectId: string, checkId: string, hitoId?: string) {
  requireEditor(ctx);
  const [, [check]] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    db
      .select({ id: obraHitoChecks.id })
      .from(obraHitoChecks)
      .innerJoin(obraHitos, eq(obraHitos.id, obraHitoChecks.hitoId))
      .where(
        and(
          eq(obraHitoChecks.id, checkId),
          eq(obraHitos.projectId, projectId),
          eq(obraHitos.tenantId, ctx.tenantId),
          hitoId === undefined ? undefined : eq(obraHitos.id, hitoId),
        ),
      ),
  ]);
  if (!check) fail("not_found");
}

/** Body: { label?, done? } */
export async function updateCheck(
  ctx: Ctx,
  projectId: string,
  checkId: string,
  input: Record<string, unknown>,
  hitoId?: string,
) {
  await checkInProject(ctx, projectId, checkId, hitoId);
  const changes = pickChanges<typeof obraHitoChecks.$inferInsert>(input, {
    label: (v) => requiredText(v, MAX_CHECK),
    done: (v) => (typeof v === "boolean" ? v : fail("invalid_input")),
  });
  if (Object.keys(changes).length > 0) {
    await db.update(obraHitoChecks).set(changes).where(eq(obraHitoChecks.id, checkId));
  }
  return { checkId };
}

export async function deleteCheck(ctx: Ctx, projectId: string, checkId: string, hitoId?: string) {
  await checkInProject(ctx, projectId, checkId, hitoId);
  await db.delete(obraHitoChecks).where(eq(obraHitoChecks.id, checkId));
  return { checkId };
}

// ─── Acta photos ─────────────────────────────────────────────────────────────

/** Body: { photoIds } — the project's photos for the acta fotográfica (replaces the set). */
export async function setActaPhotos(
  ctx: Ctx,
  projectId: string,
  hitoId: string,
  input: Record<string, unknown>,
) {
  await hitoInProject(ctx, projectId, hitoId);
  if (!Array.isArray(input.photoIds)) fail("invalid_input");
  const photoIds = [...new Set(input.photoIds as unknown[])];
  if (photoIds.some((id) => typeof id !== "string")) fail("invalid_input");
  const ids = photoIds as string[];
  if (ids.length > 0) {
    const found = await db
      .select({ id: projectPhotos.id })
      .from(projectPhotos)
      .where(
        and(
          inArray(projectPhotos.id, ids),
          eq(projectPhotos.projectId, projectId),
          eq(projectPhotos.tenantId, ctx.tenantId),
        ),
      );
    if (found.length !== ids.length) fail("not_found");
  }
  await db.transaction(async (tx) => {
    await tx.delete(obraHitoPhotos).where(eq(obraHitoPhotos.hitoId, hitoId));
    if (ids.length > 0) {
      await tx
        .insert(obraHitoPhotos)
        .values(ids.map((photoId) => ({ hitoId, photoId, tenantId: ctx.tenantId })));
    }
  });
  return { hitoId };
}

// ─── Acta and invoice files ──────────────────────────────────────────────────

const FILE_COLUMNS = {
  acta: { pathname: "actaPathname", size: "actaSizeBytes", date: "actaSignedOn" },
  invoice: { pathname: "invoicePathname", size: "invoiceSizeBytes", date: "invoicedOn" },
} as const satisfies Record<HitoFileKind, Record<string, keyof HitoRow>>;

const FILE_NAMES: Record<HitoFileKind, string> = {
  acta: "Acta de conformidad",
  invoice: "Factura",
};

/**
 * Body (multipart form): { file (PDF, ≤ 4 MB), date } — the date the acta was
 * signed (required), or the invoice's date (default: today). Replaces any
 * earlier file of that kind.
 */
export async function uploadHitoFile(
  ctx: Ctx,
  projectId: string,
  hitoId: string,
  kind: HitoFileKind,
  input: Record<string, unknown>,
) {
  const hito = await hitoInProject(ctx, projectId, hitoId);
  const { file } = input;
  if (!(file instanceof Blob) || file.size === 0) fail("missing_file");
  if (file.size > MAX_DOCUMENT_BYTES) fail("file_too_large");
  if (!(await isPdf(file))) fail("invalid_file_type");
  const date =
    kind === "invoice" && (input.date === undefined || input.date === "")
      ? todayInSpain()
      : calendarDate(input.date);

  const columns = FILE_COLUMNS[kind];
  const previous = hito[columns.pathname];
  const pathname = `${projectFolder(ctx.tenantId, projectId)}hitos/${hitoId}/${kind}-${crypto.randomUUID()}.pdf`;
  await storeFiles([{ pathname, body: file, contentType: "application/pdf" }], () =>
    touch(hitoId, { [columns.pathname]: pathname, [columns.size]: file.size, [columns.date]: date }),
  );
  if (previous) await deleteFile(previous).catch(() => {});
  return { hitoId };
}

export async function removeHitoFile(
  ctx: Ctx,
  projectId: string,
  hitoId: string,
  kind: HitoFileKind,
) {
  const hito = await hitoInProject(ctx, projectId, hitoId);
  const columns = FILE_COLUMNS[kind];
  const pathname = hito[columns.pathname];
  if (!pathname) return { hitoId };
  await removeFiles([pathname], () =>
    touch(hitoId, { [columns.pathname]: null, [columns.size]: null, [columns.date]: null }),
  );
  return { hitoId };
}

function openFile(hito: HitoRow | undefined, kind: HitoFileKind) {
  const columns = FILE_COLUMNS[kind];
  const pathname = hito?.[columns.pathname];
  if (!hito || !pathname) fail("not_found");
  return openStoredFile({
    pathname,
    filename: `${FILE_NAMES[kind]} ${hito.code}.pdf`,
    contentType: "application/pdf",
    sizeBytes: hito[columns.size] ?? 0,
  });
}

/** A hito's acta or invoice, for staff of the project's tenant. */
export async function openHitoFile(
  ctx: Ctx,
  projectId: string,
  hitoId: string,
  kind: HitoFileKind,
) {
  return openFile(await findHito(ctx, projectId, hitoId), kind);
}

/** A hito's acta or invoice, for the client of its project (mobile app). */
export async function openClientHitoFile(
  tenantId: string,
  clientUserId: string,
  hitoId: string,
  kind: HitoFileKind,
) {
  const project = await clientProject(tenantId, clientUserId);
  const hito = project
    ? await db.query.obraHitos.findFirst({
        where: and(eq(obraHitos.id, hitoId), eq(obraHitos.projectId, project.id)),
      })
    : undefined;
  return openFile(hito, kind);
}

// ─── Payment ─────────────────────────────────────────────────────────────────

/** Body: { paidOn, amountCents? } — the amount defaults to the hito's price with VAT. */
export async function registerPayment(
  ctx: Ctx,
  projectId: string,
  hitoId: string,
  input: Record<string, unknown>,
) {
  await hitoInProject(ctx, projectId, hitoId);
  const paidOn = calendarDate(input.paidOn);
  let amountCents: number;
  if (input.amountCents === undefined || input.amountCents === null) {
    const hito = (await loadObra(ctx.tenantId, projectId)).hitos.find((h) => h.id === hitoId)!;
    amountCents = hito.totalCents;
  } else {
    amountCents = integer(input.amountCents, 0, 2_000_000_000);
  }
  await touch(hitoId, { paidOn, paidAmountCents: amountCents });
  return { hitoId };
}

export async function cancelPayment(ctx: Ctx, projectId: string, hitoId: string) {
  await hitoInProject(ctx, projectId, hitoId);
  await touch(hitoId, { paidOn: null, paidAmountCents: null });
  return { hitoId };
}
