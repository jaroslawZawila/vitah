import {
  and,
  asc,
  budgetChapters,
  budgetLines,
  budgetRevisions,
  count,
  db,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  obraChapterProgress,
  obraHitoChapters,
  obraHitos,
  obraInvoiceRequests,
  obraIssueFiles,
  obraIssues,
  obraProgressEvents,
  or,
  projectPhotos,
  projects,
  sql,
  users,
} from "@repo/db";
import { toCalendarDate } from "./calendar";
import { markChanged } from "./changes";
import { raiseStage } from "./obra-stage";
import { requireEditor, type Ctx } from "./context";
import {
  CONTINGENCY_CHAPTER,
  ISSUE_FILE_TYPES,
  MAX_ISSUE_FILE_BYTES,
  fileTypeOf,
  type ConstructionControl,
  type ConstructionCosts,
  type ControlChapter,
  type ControlChapterDetail,
  type ControlHeader,
  type ControlMilestone,
  type ControlSources,
  type Hito,
  type InvoiceRequest,
  type IssueFile,
  type ObraIssue,
  type ObraStage,
  type ProgressEvent,
} from "./contract";
import { chapterState, chapterTiming, contractTotals, deviation, milestoneState } from "./control-calc";
import { idempotent } from "./idempotency";
import { MAX_TEXT } from "./input";
import { changesOf, parse } from "./inputs/fields";
import { chapterCorrectionSchema, chapterDateSchema, issueChangesSchema, issueListSchema, newIssueSchema } from "./inputs/construction";
import { fail, loadObra, requireProject, userName } from "./obra-data";
import { todayInSpain } from "./obra-calc";
import { listPhotos } from "./photos";
import { obraContract, obraSchedule } from "./planning";
import { contractingOf, loadProjectOrders } from "./purchasing";
import { inLiveProject, projectInTenant, softDeleted, type Tx } from "./project-client";
import { isPdf, openStoredFile, projectFolder, storeFiles, type StoredFile } from "./project-files";
import { listProjectAttention } from "./subcontractors";

// ─── Construction control ────────────────────────────────────────────────────
// The project's Obra tab: the technical follow-up of the works. Each budget
// chapter of the contract moves pending → in progress → finished only by the
// actual dates staff record here (and every record and correction is kept);
// finishing the last chapter of a hito asks Administration to invoice it,
// once. The budget, the hitos' invoices and payments, the subcontractors'
// documents, the photos and what Compras contracted are read from their own
// services, never copied. Planned dates are Planning's approved baseline;
// without one ./control-calc stands in for it.
// Staff only; the client's app sees the result as the obra's progress.
// ─────────────────────────────────────────────────────────────────────────────

const RECENT_PHOTOS = 6;
const RECENT_EVENTS = 5;
const MAX_EVENTS = 1000;


type ProgressRow = typeof obraChapterProgress.$inferSelect;

/**
 * The chapters of a revision's contract that are built (they have lines; the
 * chosen options too), never chapter 20, the contingency reserve. Light: no
 * lines are loaded.
 */
async function contractChapters(revisionId: string) {
  const rows = await db
    .selectDistinct({
      code: budgetChapters.code,
      name: budgetChapters.name,
      kind: budgetChapters.kind,
      position: budgetChapters.position,
    })
    .from(budgetChapters)
    .innerJoin(budgetLines, eq(budgetLines.chapterId, budgetChapters.id))
    .where(
      and(
        eq(budgetChapters.revisionId, revisionId),
        or(eq(budgetChapters.kind, "chapter"), eq(budgetChapters.chosen, true)),
        ne(budgetChapters.code, CONTINGENCY_CHAPTER),
      ),
    )
    .orderBy(asc(budgetChapters.kind), asc(budgetChapters.position));
  return rows.map(({ code, name }) => ({ code, name }));
}

const acceptedRevision = (tenantId: string, projectId: string) =>
  db.query.budgetRevisions.findFirst({
    where: and(
      eq(budgetRevisions.projectId, projectId),
      eq(budgetRevisions.tenantId, tenantId),
      eq(budgetRevisions.status, "accepted"),
    ),
    columns: { id: true, number: true },
  });

/** The contract chapters' codes, for checking a write; `project_not_found` outside the tenant. */
async function contractCodes(ctx: Ctx, projectId: string) {
  const [, revision] = await Promise.all([requireProject(ctx.tenantId, projectId), acceptedRevision(ctx.tenantId, projectId)]);
  return new Set(revision ? (await contractChapters(revision.id)).map((c) => c.code) : []);
}

/** Everything the tab is built from, for one project. */
async function loadControl(ctx: Ctx, projectId: string) {
  const [project, obra, previous, purchases] = await Promise.all([
    db.query.projects.findFirst({
      where: projectInTenant(ctx.tenantId, projectId),
      columns: {
        id: true,
        ref: true,
        address: true,
        startDate: true,
        completionDate: true,
        obraStage: true,
        obraReviewedRevisionId: true,
      },
      with: { client: { columns: { name: true, email: true } } },
    }),
    loadObra(ctx.tenantId, projectId),
    // The contract before the current one, to flag what the change added or removed.
    db.query.budgetRevisions.findFirst({
      where: and(
        eq(budgetRevisions.projectId, projectId),
        eq(budgetRevisions.tenantId, ctx.tenantId),
        eq(budgetRevisions.status, "superseded"),
        isNotNull(budgetRevisions.acceptedAt),
      ),
      orderBy: desc(budgetRevisions.number),
      columns: { id: true },
    }),
    loadProjectOrders(ctx.tenantId, projectId),
  ]);
  if (!project) fail("project_not_found");
  const { revision, hitos, progress, costChapters, progressRows, requests } = obra;

  // While staff haven't reviewed the change, what the previous contract had.
  const reviewing = Boolean(revision && previous && project.obraReviewedRevisionId !== revision.id);
  const previousCodes = reviewing ? new Map((await contractChapters(previous!.id)).map((c) => [c.code, c.name])) : null;

  const today = todayInSpain();
  const works = { startDate: toCalendarDate(project.startDate), completionDate: toCalendarDate(project.completionDate) };
  // The main budget items: the contract's chapters at cost, but not the contingency.
  const contract = obraContract(obra, works);
  const { items, dates, states, plan, planSource } = contract;
  const hitoOf = new Map(hitos.flatMap((h) => h.chapters.map((c) => [c.code, h] as const)));
  const requestOf = new Map(requests.map((r) => [r.hitoId, toRequest(r, hitos)]));

  return {
    project,
    obra,
    contract,
    works,
    clientName: project.client ? (project.client.name ?? project.client.email) : null,
    revision,
    hitos,
    // The contract price: the accepted revision's priced chapters and chosen options.
    contractCents: progress.totalCents,
    items,
    contingencyCents: costChapters.find((c) => c.code === CONTINGENCY_CHAPTER)?.totalCents ?? 0,
    previousCodes,
    progressRows,
    dates,
    states,
    hitoOf,
    plan,
    sources: { planning: planSource, purchasing: "live" } satisfies ControlSources,
    requestOf,
    contracts: purchases.contracts,
    orders: purchases.orders,
    lateDeliveries: purchases.orders.filter((o) => o.lateDays !== null),
    today,
  };
}

type Control = Awaited<ReturnType<typeof loadControl>>;

function toRequest(
  row: typeof obraInvoiceRequests.$inferSelect & { requestedBy: string | null },
  hitos: Hito[],
): InvoiceRequest {
  return {
    id: row.id,
    hitoId: row.hitoId,
    hitoCode: hitos.find((h) => h.id === row.hitoId)?.code ?? "",
    chapterCode: row.chapterCode,
    amountCents: row.amountCents,
    description: row.description,
    clientName: row.clientName,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt.toISOString(),
  };
}

function toChapter(control: Control, item: Control["items"][number], openIssues: number): ControlChapter {
  const { dates, plan, hitoOf, today, previousCodes } = control;
  const recorded = dates.get(item.code);
  const planned = plan.get(item.code);
  const timing = chapterTiming(recorded, planned, today);
  const totals = contractTotals(item.lines, control.contracts);
  return {
    code: item.code,
    name: item.name,
    ...timing,
    plannedStart: planned?.start ?? null,
    plannedEnd: planned?.end ?? null,
    actualStart: recorded?.actualStart ?? null,
    actualEnd: recorded?.actualEnd ?? null,
    hitoCode: hitoOf.get(item.code)?.code ?? null,
    costCents: item.totalCents,
    lineCount: item.lines.length,
    contractedLines: totals.closedLines,
    openLines: totals.openLines,
    contractedCents: totals.closedLines + totals.openLines > 0 ? totals.contractedCents : null,
    contractedCostCents: totals.closedCostCents,
    // Only the closed lines: one with more still to order never counts as a saving.
    deviationCents: totals.deviationCents,
    deviationBp: totals.deviationBp,
    openIssues,
    added: previousCodes !== null && !previousCodes.has(item.code),
  };
}

function toMilestone(control: Control, hito: Hito): ControlMilestone {
  const chapters = hito.chapters
    .filter((c) => control.states.has(c.code))
    .map((c) => ({ code: c.code, name: c.name, state: control.states.get(c.code)! }));
  const request = control.requestOf.get(hito.id) ?? null;
  // An invoice is for the agreed amount: there's no partial invoicing.
  const invoiced = hito.invoicedOn || hito.paidOn ? hito.amountCents : 0;
  const collected = hito.paidOn ? hito.amountCents : 0;
  return {
    id: hito.id,
    code: hito.code,
    name: hito.name,
    pctBp: hito.pctBp,
    amountCents: hito.amountCents,
    chapters,
    state: milestoneState({
      chapterStates: chapters.map((c) => c.state),
      requested: request !== null,
      invoicedOn: hito.invoicedOn,
      paidOn: hito.paidOn,
    }),
    invoicedCents: invoiced,
    collectedCents: collected,
    outstandingCents: invoiced - collected,
    invoicedOn: hito.invoicedOn,
    paidOn: hito.paidOn,
    hasInvoice: hito.invoicedOn !== null,
    request,
  };
}

// ─── Reads ───────────────────────────────────────────────────────────────────

const issuesOf = (ctx: Ctx, projectId: string) =>
  and(eq(obraIssues.projectId, projectId), eq(obraIssues.tenantId, ctx.tenantId));
const isOpenIssue = ne(obraIssues.status, "resolved");

async function issueRows(ctx: Ctx, projectId: string, where?: ReturnType<typeof and>) {
  const rows = await db
    .select({ issue: obraIssues, by: userName })
    .from(obraIssues)
    .leftJoin(users, eq(users.id, obraIssues.createdById))
    .where(and(issuesOf(ctx, projectId), where))
    .orderBy(desc(obraIssues.occurredOn), desc(obraIssues.createdAt));
  const files = new Map<string, IssueFile[]>();
  if (rows.length > 0) {
    const fileRows = await db
      .select()
      .from(obraIssueFiles)
      .where(
        and(
          eq(obraIssueFiles.tenantId, ctx.tenantId),
          inArray(obraIssueFiles.issueId, rows.map((r) => r.issue.id)),
          isNull(obraIssueFiles.deletedAt),
        ),
      )
      .orderBy(asc(obraIssueFiles.createdAt));
    for (const { issueId, id, filename, contentType, sizeBytes } of fileRows) {
      files.set(issueId, [...(files.get(issueId) ?? []), { id, filename, contentType, sizeBytes }]);
    }
  }
  return rows.map(({ issue, by }): ObraIssue => ({
    id: issue.id,
    kind: issue.kind,
    number: issue.number,
    occurredOn: issue.occurredOn,
    chapterCode: issue.chapterCode,
    description: issue.description,
    party: issue.party,
    partyName: issue.partyName,
    costImpactCents: issue.costImpactCents,
    scheduleImpactDays: issue.scheduleImpactDays,
    status: issue.status,
    files: files.get(issue.id) ?? [],
    createdBy: by,
    createdAt: issue.createdAt.toISOString(),
    updatedAt: issue.updatedAt.toISOString(),
  }));
}

async function eventRows(ctx: Ctx, projectId: string, { chapterCode, limit }: { chapterCode?: string; limit?: number }) {
  const rows = await db
    .select({ event: obraProgressEvents, by: userName })
    .from(obraProgressEvents)
    .leftJoin(users, eq(users.id, obraProgressEvents.recordedById))
    .where(
      and(
        eq(obraProgressEvents.projectId, projectId),
        eq(obraProgressEvents.tenantId, ctx.tenantId),
        chapterCode === undefined ? undefined : eq(obraProgressEvents.chapterCode, chapterCode),
      ),
    )
    .orderBy(desc(obraProgressEvents.recordedAt))
    .limit(limit ?? MAX_EVENTS);
  return rows.map(({ event, by }): ProgressEvent => ({
    id: event.id,
    chapterCode: event.chapterCode,
    kind: event.kind,
    previousDate: event.previousDate,
    newDate: event.newDate,
    note: event.note,
    recordedBy: by,
    recordedAt: event.recordedAt.toISOString(),
  }));
}

function countByChapter(issues: ObraIssue[]) {
  const counts = new Map<string, number>();
  for (const issue of issues) counts.set(issue.chapterCode, (counts.get(issue.chapterCode) ?? 0) + 1);
  return counts;
}

/** The Obra tab's summary and its chapters' progress. Read-only: nothing here changes data. */
export async function getControl(ctx: Ctx, projectId: string): Promise<ConstructionControl> {
  const [control, openIssues, events, photos, photoCount, documentAlerts] = await Promise.all([
    loadControl(ctx, projectId),
    issueRows(ctx, projectId, isOpenIssue),
    eventRows(ctx, projectId, { limit: RECENT_EVENTS }),
    listPhotos(ctx, projectId, { limit: RECENT_PHOTOS }),
    db.$count(
      projectPhotos,
      and(eq(projectPhotos.projectId, projectId), eq(projectPhotos.tenantId, ctx.tenantId), isNull(projectPhotos.deletedAt)),
    ),
    listProjectAttention(ctx, projectId),
  ]);
  const { project, works, revision, items, hitos, previousCodes, dates } = control;
  const open = countByChapter(openIssues);
  const chapters = items.map((item) => toChapter(control, item, open.get(item.code) ?? 0));
  const milestones = hitos.map((h) => toMilestone(control, h));
  const itemCodes = new Set(items.map((c) => c.code));

  // Chapters that left the contract keep what was recorded on them.
  const removedCodes = new Set([
    ...control.progressRows.filter((r) => r.actualStart && !itemCodes.has(r.chapterCode)).map((r) => r.chapterCode),
    ...[...(previousCodes?.keys() ?? [])].filter((c) => !itemCodes.has(c)),
  ]);
  const removedChapters = [...removedCodes].sort().map((code) => ({
    code,
    name: previousCodes?.get(code) ?? null,
    actualStart: dates.get(code)?.actualStart ?? null,
    actualEnd: dates.get(code)?.actualEnd ?? null,
  }));

  const sum = (values: number[]) => values.reduce((total, v) => total + v, 0);
  const contractedCents = sum(chapters.map((c) => c.contractedCents ?? 0));
  const contractedCostCents = sum(chapters.map((c) => c.contractedCostCents));
  const total = deviation(contractedCostCents, contractedCostCents + sum(chapters.map((c) => c.deviationCents ?? 0)));
  const { contractCents } = control;
  const invoicedCents = sum(milestones.map((m) => m.invoicedCents));
  const collectedCents = sum(milestones.map((m) => m.collectedCents));
  const names = new Map(items.map((c) => [c.code, c.name]));

  return {
    project: {
      ref: project.ref,
      address: project.address,
      clientName: control.clientName,
      ...works,
      stage: project.obraStage as ObraStage,
    },
    budget: revision && { revisionId: revision.id, number: revision.number, reference: revision.reference },
    today: control.today,
    chapters,
    removedChapters,
    reviewPending: previousCodes !== null && (chapters.some((c) => c.added) || removedChapters.some((c) => c.name !== null)),
    cost: {
      budgetedCents: sum(chapters.map((c) => c.costCents)),
      contractedCents,
      contractedCostCents,
      deviationCents: total.deviationCents ?? 0,
      deviationBp: total.deviationBp ?? 0,
      contingencyCents: control.contingencyCents,
    },
    sales: {
      contractCents,
      invoicedCents,
      collectedCents,
      outstandingCents: invoicedCents - collectedCents,
      toInvoiceCents: contractCents - invoicedCents,
    },
    milestones,
    documentAlerts,
    lateDeliveries: control.lateDeliveries,
    issues: openIssues,
    events: events.map((e) => ({ ...e, chapterName: names.get(e.chapterCode) ?? null })),
    photos,
    photoCount,
    sources: control.sources,
    // On time or late: the same rule and inputs as Planificación's.
    schedule: obraSchedule(control.obra, works, control.today, control.contract),
  };
}

/** What every Obra page's header and forms need, without the whole control. */
export async function getControlHeader(ctx: Ctx, projectId: string): Promise<ControlHeader> {
  const [project, revision, [open]] = await Promise.all([
    db.query.projects.findFirst({
      where: projectInTenant(ctx.tenantId, projectId),
      columns: { ref: true, obraStage: true },
    }),
    acceptedRevision(ctx.tenantId, projectId),
    db.select({ n: count() }).from(obraIssues).where(and(issuesOf(ctx, projectId), isOpenIssue)),
  ]);
  if (!project) fail("project_not_found");
  return {
    ref: project.ref,
    stage: project.obraStage as ObraStage,
    budgetNumber: revision?.number ?? null,
    openIssues: open?.n ?? 0,
    chapters: revision ? await contractChapters(revision.id) : [],
    today: todayInSpain(),
  };
}

/** One chapter: its dates and history, its hito, its issues and photos, its lines' %. */
export async function getControlChapter(ctx: Ctx, projectId: string, code: string): Promise<ControlChapterDetail> {
  const [control, issues, events, photos] = await Promise.all([
    loadControl(ctx, projectId),
    issueRows(ctx, projectId, eq(obraIssues.chapterCode, code)),
    eventRows(ctx, projectId, { chapterCode: code }),
    listPhotos(ctx, projectId, { chapterCode: code }),
  ]);
  const item = control.items.find((c) => c.code === code);
  if (!item) fail("not_found");
  const hito = control.hitoOf.get(code);
  return {
    chapter: toChapter(control, item, issues.filter((i) => i.status !== "resolved").length),
    milestone: hito ? toMilestone(control, hito) : null,
    events,
    issues,
    photos,
    lines: item.lines.map(({ id, code: lineCode, description, unit, executedPct }) => ({
      id,
      code: lineCode,
      description,
      unit,
      executedPct,
    })),
    orders: control.orders.filter((o) => o.chapterCodes.includes(code)),
    today: control.today,
    sources: control.sources,
  };
}

/** Cost control per budget line: its budgeted cost against what was contracted. */
export async function getCosts(ctx: Ctx, projectId: string): Promise<ConstructionCosts> {
  const { items, states, contracts, lateDeliveries, sources } = await loadControl(ctx, projectId);
  return {
    chapters: items.map((item) => ({
      code: item.code,
      name: item.name,
      state: states.get(item.code)!,
      lines: item.lines.map((line) => {
        const contract = contracts.get(line.lineageId);
        const contracting = contractingOf(contract);
        return {
          id: line.id,
          code: line.code,
          description: line.description,
          unit: line.unit,
          quantity: line.quantity,
          costCents: line.amountCents,
          contractedCents: contract?.contractedCents ?? null,
          contracting,
          orders: contract?.orders ?? [],
          ...deviation(line.amountCents, contracting === "closed" ? contract!.contractedCents : null),
        };
      }),
    })),
    lateDeliveries,
    sources,
  };
}

/** The project's issues and changes, newest first; `kind` filters them. */
export async function listIssues(ctx: Ctx, projectId: string, query: { kind?: string } = {}) {
  await requireProject(ctx.tenantId, projectId);
  const filter = parse(issueListSchema, query).kind;
  return issueRows(ctx, projectId, filter && eq(obraIssues.kind, filter));
}

// ─── Progress: start, finish, correct ────────────────────────────────────────

/** A chapter of the contract, for writing its dates; `not_found` otherwise. */
async function requireItem(ctx: Ctx, projectId: string, code: string) {
  requireEditor(ctx);
  if (!(await contractCodes(ctx, projectId)).has(code)) fail("not_found");
}

async function lockedRow(tx: Tx, ctx: Ctx, projectId: string, code: string): Promise<ProgressRow | undefined> {
  const [row] = await tx
    .select()
    .from(obraChapterProgress)
    .where(
      and(
        eq(obraChapterProgress.projectId, projectId),
        eq(obraChapterProgress.tenantId, ctx.tenantId),
        eq(obraChapterProgress.chapterCode, code),
      ),
    )
    .for("update");
  return row;
}

async function saveDates(
  tx: Tx,
  ctx: Ctx,
  projectId: string,
  code: string,
  values: { actualStart: string | null; actualEnd: string | null },
) {
  await tx
    .insert(obraChapterProgress)
    .values({ tenantId: ctx.tenantId, projectId, chapterCode: code, ...values })
    .onConflictDoUpdate({
      target: [obraChapterProgress.projectId, obraChapterProgress.chapterCode],
      set: { ...values, updatedAt: new Date() },
    });
}

async function logEvent(
  tx: Tx,
  ctx: Ctx,
  projectId: string,
  code: string,
  event: Pick<typeof obraProgressEvents.$inferInsert, "kind" | "previousDate" | "newDate" | "note">,
) {
  await tx.insert(obraProgressEvents).values({
    tenantId: ctx.tenantId,
    projectId,
    chapterCode: code,
    recordedById: ctx.userId,
    ...event,
  });
}

/**
 * What finishing `code` could ask Administration to invoice: its hito, the
 * hito's contract chapters and the request's content. Loaded before the
 * write's transaction, so the transaction holds its locks only briefly.
 */
async function invoicePlan(ctx: Ctx, projectId: string, code: string) {
  const [obra, project] = await Promise.all([
    loadObra(ctx.tenantId, projectId),
    db.query.projects.findFirst({
      where: projectInTenant(ctx.tenantId, projectId),
      columns: {},
      with: { client: { columns: { name: true, email: true } } },
    }),
  ]);
  const hito = obra.hitos.find((h) => h.chapters.some((c) => c.code === code));
  if (!hito) return null;
  const mapped = await db
    .select({ code: obraHitoChapters.chapterCode })
    .from(obraHitoChapters)
    .where(eq(obraHitoChapters.hitoId, hito.id))
    .orderBy(asc(obraHitoChapters.chapterCode));
  return {
    hito,
    codes: hito.chapters.map((c) => c.code).filter((c) => c !== CONTINGENCY_CHAPTER),
    // Its chapters as they are mapped, whether or not they were all in the contract.
    description: `${hito.code} ${hito.name} (${mapped.map((m) => m.code).join(", ")})`,
    clientName: project?.client ? (project.client.name ?? project.client.email) : null,
  };
}

type InvoicePlan = Awaited<ReturnType<typeof invoicePlan>>;

/**
 * After a chapter's finish is recorded: when every chapter of its hito is now
 * finished, asks Administration to invoice the hito, once (a hito never gets
 * a second request, whatever is corrected later). The hito is locked first,
 * so two of its chapters finished at the same time still make one request.
 * Returns the hito's code when this call made the request.
 */
async function requestInvoice(tx: Tx, ctx: Ctx, projectId: string, code: string, plan: InvoicePlan) {
  if (!plan || plan.codes.length === 0) return null;
  const { hito } = plan;
  await tx.select({ id: obraHitos.id }).from(obraHitos).where(eq(obraHitos.id, hito.id)).for("update");
  // Read after the lock: every finish recorded before is in, this one too.
  const finished = await tx
    .select({ code: obraChapterProgress.chapterCode })
    .from(obraChapterProgress)
    .where(
      and(
        eq(obraChapterProgress.projectId, projectId),
        eq(obraChapterProgress.tenantId, ctx.tenantId),
        isNotNull(obraChapterProgress.actualEnd),
        inArray(obraChapterProgress.chapterCode, plan.codes),
      ),
    );
  if (finished.length < plan.codes.length) return null;
  const [made] = await tx
    .insert(obraInvoiceRequests)
    .values({
      tenantId: ctx.tenantId,
      projectId,
      hitoId: hito.id,
      chapterCode: code,
      amountCents: hito.amountCents,
      description: plan.description,
      clientName: plan.clientName,
      requestedById: ctx.userId,
    })
    .onConflictDoNothing()
    .returning({ id: obraInvoiceRequests.id });
  return made ? hito.code : null;
}

/** Body: { date } — the day work started (may be before today). Pending → in progress. */
export async function startChapter(ctx: Ctx, projectId: string, code: string, input: Record<string, unknown>) {
  await requireItem(ctx, projectId, code);
  const { date } = parse(chapterDateSchema, input);
  await db.transaction(async (tx) => {
    const row = await lockedRow(tx, ctx, projectId, code);
    if (row?.actualStart) fail("invalid_state");
    await saveDates(tx, ctx, projectId, code, { actualStart: date, actualEnd: null });
    await logEvent(tx, ctx, projectId, code, { kind: "start", previousDate: null, newDate: date, note: null });
  });
  await markChanged(ctx.tenantId, projectId, ["obra"]);
  await raiseStage(ctx.tenantId, projectId);
  return { state: "in_progress" as const };
}

/**
 * Body: { date } — the day work finished (may be before today, not before its
 * start). In progress → finished; may ask for the hito's invoice.
 */
export async function finishChapter(ctx: Ctx, projectId: string, code: string, input: Record<string, unknown>) {
  await requireItem(ctx, projectId, code);
  const { date } = parse(chapterDateSchema, input);
  const plan = await invoicePlan(ctx, projectId, code);
  const invoiceRequested = await db.transaction(async (tx) => {
    const row = await lockedRow(tx, ctx, projectId, code);
    if (!row?.actualStart || row.actualEnd) fail("invalid_state");
    if (date < row.actualStart) fail("invalid_date");
    await saveDates(tx, ctx, projectId, code, { actualStart: row.actualStart, actualEnd: date });
    await logEvent(tx, ctx, projectId, code, { kind: "finish", previousDate: null, newDate: date, note: null });
    return requestInvoice(tx, ctx, projectId, code, plan);
  });
  await markChanged(ctx.tenantId, projectId, ["obra"]);
  await raiseStage(ctx.tenantId, projectId);
  return { state: "finished" as const, invoiceRequested };
}

/**
 * Corrects recorded dates. Body: { actualStart?, actualEnd?, note? } — each
 * a date or null to clear it (clearing the end reopens the chapter, clearing
 * the start too makes it pending). Every change is kept with its previous
 * value, who and when. Recording an end may ask for the hito's invoice, but
 * never a second time.
 */
export async function correctChapter(ctx: Ctx, projectId: string, code: string, input: Record<string, unknown>) {
  await requireItem(ctx, projectId, code);
  const { note } = parse(chapterCorrectionSchema.pick({ note: true }), input);
  // Only needed when the correction records an end (parsed below), but loaded before the locks.
  const plan = input.actualEnd ? await invoicePlan(ctx, projectId, code) : null;
  const result = await db.transaction(async (tx) => {
    const row = await lockedRow(tx, ctx, projectId, code);
    if (!row?.actualStart && !row?.actualEnd) fail("invalid_state");
    // The dates once the chapter has any: a pending one is refused first, whatever was sent.
    const sent = parse(chapterCorrectionSchema, input);
    const before = { actualStart: row.actualStart, actualEnd: row.actualEnd };
    const after = {
      actualStart: sent.actualStart === undefined ? before.actualStart : sent.actualStart,
      actualEnd: sent.actualEnd === undefined ? before.actualEnd : sent.actualEnd,
    };
    if (after.actualEnd && (!after.actualStart || after.actualEnd < after.actualStart)) fail("invalid_date");
    const changed = after.actualStart !== before.actualStart || after.actualEnd !== before.actualEnd;
    if (!changed) return { changed, state: chapterState(after), invoiceRequested: null };

    await saveDates(tx, ctx, projectId, code, after);
    if (after.actualStart !== before.actualStart) {
      await logEvent(tx, ctx, projectId, code, {
        kind: "correct_start",
        previousDate: before.actualStart,
        newDate: after.actualStart,
        note,
      });
    }
    if (after.actualEnd !== before.actualEnd) {
      await logEvent(tx, ctx, projectId, code, {
        kind: "correct_finish",
        previousDate: before.actualEnd,
        newDate: after.actualEnd,
        note,
      });
    }
    const finishedNow = !before.actualEnd && after.actualEnd;
    const invoiceRequested = finishedNow ? await requestInvoice(tx, ctx, projectId, code, plan) : null;
    return { changed, state: chapterState(after), invoiceRequested };
  });
  if (result.changed) {
    await markChanged(ctx.tenantId, projectId, ["obra"]);
    await raiseStage(ctx.tenantId, projectId);
  }
  const { changed: _, ...outcome } = result;
  return outcome;
}

/** Marks what the accepted revision added to or removed from the contract as reviewed. */
export async function reviewChanges(ctx: Ctx, projectId: string) {
  requireEditor(ctx);
  const [, revision] = await Promise.all([requireProject(ctx.tenantId, projectId), acceptedRevision(ctx.tenantId, projectId)]);
  if (!revision) fail("no_budget");
  await db
    .update(projects)
    .set({ obraReviewedRevisionId: revision.id })
    .where(projectInTenant(ctx.tenantId, projectId));
  return { revisionId: revision.id };
}

// ─── Issues and changes ──────────────────────────────────────────────────────
// A log of problems and deviations from plan, each tied to the chapter it
// affects. It records history: it never changes the budget, dates, amounts or
// statuses, and never asks for an invoice. Resolved records stay.

/** A chapter an issue is tied to: the contract's (`codes`), else `unknown_chapter`. */
function checkChapter(codes: Set<string>, chapterCode: string) {
  if (!codes.has(chapterCode)) fail("unknown_chapter");
}

/**
 * Body: { kind, occurredOn, chapterCode, description, party, partyName?,
 * costImpactCents?, scheduleImpactDays?, status?, idempotencyKey? (sent again
 * with the same key, it is one record with one number: ./idempotency) } — the
 * impacts are estimates and optional. → { issueId, number }
 */
export async function createIssue(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  return idempotent<{ issueId: string; number: number }>(ctx, "obra.issue.create", { projectId }, input, async (once) => {
    const codes = await contractCodes(ctx, projectId);
    const values = parse(newIssueSchema, input);
    checkChapter(codes, values.chapterCode);
    const sameKind = and(eq(obraIssues.projectId, projectId), eq(obraIssues.tenantId, ctx.tenantId), eq(obraIssues.kind, values.kind));
    return db.transaction((tx) =>
      once(tx, async () => {
        // Two records made at once may take the same number: the later one waits
        // for the first, then tries the next (each statement sees what is in by then).
        for (let attempt = 0; attempt < 5; attempt++) {
          const [row] = await tx
            .insert(obraIssues)
            .values({
              ...values,
              tenantId: ctx.tenantId,
              projectId,
              // Numbered per project and kind.
              number: sql`(select coalesce(max(${obraIssues.number}), 0) + 1 from ${obraIssues} where ${sameKind})`,
              createdById: ctx.userId,
            })
            .onConflictDoNothing()
            .returning({ id: obraIssues.id, number: obraIssues.number });
          if (row) return { issueId: row.id, number: row.number };
        }
        throw new Error("Could not number the issue");
      }),
    );
  });
}

/** The project's issue, by its id; not found once its project is deleted. */
async function requireIssue(ctx: Ctx, projectId: string, issueId: string) {
  const issue = await db.query.obraIssues.findFirst({
    where: and(eq(obraIssues.id, issueId), issuesOf(ctx, projectId), inLiveProject(obraIssues.projectId)),
    columns: { id: true },
  });
  if (!issue) fail("not_found");
  return issue;
}

/** Body: any of createIssue's fields, status included. */
export async function updateIssue(ctx: Ctx, projectId: string, issueId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  await requireIssue(ctx, projectId, issueId);
  const changes = changesOf(parse(issueChangesSchema, input));
  // Only a new chapter needs checking against the contract.
  if (changes.chapterCode !== undefined) checkChapter(await contractCodes(ctx, projectId), changes.chapterCode);
  if (Object.keys(changes).length > 0) {
    await db.update(obraIssues).set(changes).where(eq(obraIssues.id, issueId));
  }
  return { issueId };
}

/** Body (multipart form): { file } — a photo, email or document of at most 4 MB. → { fileId } */
export async function addIssueFile(ctx: Ctx, projectId: string, issueId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  await requireIssue(ctx, projectId, issueId);
  const { file } = input;
  if (!(file instanceof File) || file.size === 0) fail("missing_file");
  if (file.size > MAX_ISSUE_FILE_BYTES) fail("file_too_large");
  const type = fileTypeOf(file.name, ISSUE_FILE_TYPES);
  if (!type || (type.extension === "pdf" && !(await isPdf(file)))) fail("invalid_file_type");

  const id = crypto.randomUUID();
  const pathname = `${projectFolder(ctx.tenantId, projectId)}issues/${issueId}/${id}.${type.extension}`;
  await storeFiles([{ pathname, body: file, contentType: type.contentType }], () =>
    db.insert(obraIssueFiles).values({
      id,
      tenantId: ctx.tenantId,
      issueId,
      filename: file.name.slice(0, MAX_TEXT),
      pathname,
      contentType: type.contentType,
      sizeBytes: file.size,
      uploadedById: ctx.userId,
    }),
  );
  return { fileId: id };
}

/** An issue's file that hasn't been deleted: a deleted one keeps its row and its file, and no read finds it. */
function fileInIssue(ctx: Ctx, issueId: string, fileId: string) {
  return and(
    eq(obraIssueFiles.id, fileId),
    eq(obraIssueFiles.issueId, issueId),
    eq(obraIssueFiles.tenantId, ctx.tenantId),
    isNull(obraIssueFiles.deletedAt),
  );
}

/** Takes a file off the issue. Its row and the stored file are kept: it is marked deleted, with who did it. */
export async function deleteIssueFile(ctx: Ctx, projectId: string, issueId: string, fileId: string) {
  requireEditor(ctx);
  await requireIssue(ctx, projectId, issueId);
  const [deleted] = await db
    .update(obraIssueFiles)
    .set(softDeleted(ctx))
    .where(fileInIssue(ctx, issueId, fileId))
    .returning({ id: obraIssueFiles.id });
  if (!deleted) fail("not_found");
  return { fileId };
}

/** An issue's file, for download; every staff member may read it. */
export async function openIssueFile(ctx: Ctx, projectId: string, issueId: string, fileId: string): Promise<StoredFile> {
  await requireIssue(ctx, projectId, issueId);
  const file = await db.query.obraIssueFiles.findFirst({
    where: fileInIssue(ctx, issueId, fileId),
    columns: { filename: true, contentType: true, sizeBytes: true, pathname: true },
  });
  if (!file) fail("not_found");
  return openStoredFile(file);
}
