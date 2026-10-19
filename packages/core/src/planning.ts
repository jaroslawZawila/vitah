import { and, asc, budgetChapters, budgetRevisions, db, desc, eq, inArray, ne, planningItems, planningVersions, projects } from "@repo/db";
import { isUniqueViolation } from "./accounts";
import { markChanged } from "./changes";
import { requireEditor, type Ctx } from "./context";
import {
  CONTINGENCY_CHAPTER,
  PLANNING_REGIONS,
  type ObraStage,
  type PlanningCalendar,
  type PlanningDraft,
  type PlanningItemInput,
  type PlanningRegion,
  type PlanningRow,
  type PlanningVersions,
  type PlanningVersionSummary,
  type ProjectPlanning,
} from "./contract";
import { toCalendarDate } from "./calendar";
import { chapterState } from "./control-calc";
import { notifyProjectClient } from "./notifications";
import { todayInSpain } from "./obra-calc";
import {
  calendarDate,
  fail,
  integer,
  isObject,
  loadObra,
  optionalText,
  requiredText,
  requireProject,
  userNamesById,
} from "./obra-data";
import {
  clientDates,
  criticalPath,
  planCheck,
  planEnd,
  planProblem,
  schedulePlan,
  templateItems,
  type Dates,
  type Recorded,
} from "./planning-calc";
import { approvedPlanDates } from "./planning-data";

// ─── Planning ────────────────────────────────────────────────────────────────
// The works schedule (the Obra tab's Planificación): per version, each contract
// chapter's rule (what it waits for, its lag and working days) and the dates
// that gives on the project's working calendar. A draft is edited freely;
// approving it makes it the baseline (the previous one superseded), the dates
// Avance, Compras and the Obra tab measure against (read by ./obra-data's
// loadObra). What Avance records always wins over a rule. The arithmetic is in
// ./planning-calc. Staff only (admins and managers write); the client's app
// shows the approved plan's handover and phase dates, and approving one that
// moves the handover pushes it to the client.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_REASON = 500;

type VersionRow = typeof planningVersions.$inferSelect;
type ItemRow = typeof planningItems.$inferSelect;

const calendarOf = (v: VersionRow): PlanningCalendar => ({
  region: v.region as PlanningRegion | null,
  augustClosure: v.augustClosure,
  christmasClosure: v.christmasClosure,
});

const toInput = (row: ItemRow): PlanningItemInput => ({
  code: row.chapterCode,
  after: row.afterCode,
  lagDays: row.lagDays,
  durationDays: row.durationDays,
  fixedStart: row.fixedStart,
  spansWorks: row.spansWorks,
  leadDays: row.leadDays,
});

/** The project, its contract's chapters (chapter 20 aside) and what Avance recorded. */
async function loadProject(tenantId: string, projectId: string) {
  const project = await requireProject(tenantId, projectId);
  const obra = await loadObra(tenantId, projectId);
  const hitoOf = new Map(obra.hitos.flatMap((h) => h.chapters.map((c) => [c.code, h.code] as const)));
  const progressOf = new Map(obra.chapters.map((c) => [c.code, c.progressPct]));
  const chapters = obra.costChapters
    .filter((c) => c.code !== CONTINGENCY_CHAPTER)
    .map((c) => ({ code: c.code, name: c.name, hitoCode: hitoOf.get(c.code) ?? null, progressPct: progressOf.get(c.code) ?? 0 }));
  const recorded = new Map<string, Recorded>(
    obra.progressRows.map((r) => [r.chapterCode, { actualStart: r.actualStart, actualEnd: r.actualEnd }]),
  );
  return {
    project,
    stage: project.obraStage as ObraStage,
    startDate: toCalendarDate(project.startDate),
    completionDate: toCalendarDate(project.completionDate),
    chapters,
    recorded,
    contractCents: obra.progress.totalCents,
    today: todayInSpain(),
  };
}

type Loaded = Awaited<ReturnType<typeof loadProject>>;

/** The project's versions, newest first, with the open draft and the baseline among them. */
async function loadVersions(tenantId: string, projectId: string) {
  const versions = await db
    .select()
    .from(planningVersions)
    .where(and(eq(planningVersions.projectId, projectId), eq(planningVersions.tenantId, tenantId)))
    .orderBy(desc(planningVersions.number));
  return {
    versions,
    draft: versions.find((v) => v.status === "draft"),
    approved: versions.find((v) => v.status === "approved"),
  };
}

/** Each version's items, in order. */
async function loadItems(versions: (VersionRow | undefined)[]) {
  const ids = versions.flatMap((v) => (v ? [v.id] : []));
  const byVersion = new Map<string, ItemRow[]>();
  if (ids.length === 0) return byVersion;
  const rows = await db.select().from(planningItems).where(inArray(planningItems.versionId, ids)).orderBy(asc(planningItems.position));
  for (const row of rows) byVersion.set(row.versionId, [...(byVersion.get(row.versionId) ?? []), row]);
  return byVersion;
}

const namesOf = (tenantId: string, versions: VersionRow[]) =>
  userNamesById(tenantId, versions.flatMap((v) => [v.createdById, v.approvedById]));

function summaryOf(v: VersionRow, endDate: string, names: Map<string, string>): PlanningVersionSummary {
  return {
    id: v.id,
    number: v.number,
    status: v.status,
    reason: v.reason,
    startDate: v.startDate,
    endDate,
    createdBy: v.createdById ? (names.get(v.createdById) ?? null) : null,
    createdAt: v.createdAt.toISOString(),
    approvedBy: v.approvedById ? (names.get(v.approvedById) ?? null) : null,
    approvedAt: v.approvedAt?.toISOString() ?? null,
  };
}

const storedDates = (items: ItemRow[]) =>
  new Map<string, Dates>(items.map((row) => [row.chapterCode, { start: row.plannedStart, end: row.plannedEnd }]));

/** The rules' dates as of today, with what Avance recorded. */
const scheduleNow = (loaded: Loaded, startDate: string, calendar: PlanningCalendar, rules: PlanningItemInput[]) =>
  schedulePlan(rules, { startDate, calendar, recorded: loaded.recorded, today: loaded.today });

/** A version's chapters with their planned (`planned`) and forecast dates, in its order. */
function rowsOf(loaded: Loaded, items: ItemRow[], planned: Map<string, Dates>, forecast: Map<string, Dates>): PlanningRow[] {
  const critical = criticalPath(items.map(toInput), forecast, loaded.recorded);
  const chapterOf = new Map(loaded.chapters.map((c) => [c.code, c]));
  return items.map((row) => {
    const chapter = chapterOf.get(row.chapterCode);
    const recorded = loaded.recorded.get(row.chapterCode);
    const plan = planned.get(row.chapterCode)!;
    const now = forecast.get(row.chapterCode) ?? plan;
    return {
      ...toInput(row),
      name: chapter?.name ?? row.chapterCode,
      hitoCode: chapter?.hitoCode ?? null,
      plannedStart: plan.start,
      plannedEnd: plan.end,
      forecastStart: now.start,
      forecastEnd: now.end,
      state: chapterState(recorded),
      actualStart: recorded?.actualStart ?? null,
      actualEnd: recorded?.actualEnd ?? null,
      progressPct: recorded?.actualEnd ? 100 : (chapter?.progressPct ?? 0),
      critical: critical.has(row.chapterCode),
    };
  });
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/** The Obra tab's Planificación: the baseline with where it is heading, and whether a draft is open. */
export async function getPlanning(ctx: Ctx, projectId: string): Promise<ProjectPlanning> {
  const [loaded, { versions, draft, approved }] = await Promise.all([
    loadProject(ctx.tenantId, projectId),
    loadVersions(ctx.tenantId, projectId),
  ]);
  const [items, names, copyFrom] = await Promise.all([
    loadItems([approved, draft]),
    namesOf(ctx.tenantId, versions),
    otherBaselines(ctx.tenantId, projectId),
  ]);

  let baseline: ProjectPlanning["baseline"] = null;
  if (approved) {
    const rows = items.get(approved.id) ?? [];
    const planned = storedDates(rows);
    const forecast = scheduleNow(loaded, approved.startDate, calendarOf(approved), rows.map(toInput));
    const plannedEnd = planEnd(planned) ?? approved.startDate;
    baseline = {
      ...summaryOf(approved, plannedEnd, names),
      calendar: calendarOf(approved),
      rows: rowsOf(loaded, rows, planned, forecast),
      planned: planCheck(plannedEnd, loaded.completionDate, loaded.contractCents),
      forecast: planCheck(planEnd(forecast) ?? plannedEnd, loaded.completionDate, loaded.contractCents),
    };
  }
  return {
    ref: loaded.project.ref,
    stage: loaded.stage,
    startDate: loaded.startDate,
    completionDate: loaded.completionDate,
    baseline,
    draft: draft ? summaryOf(draft, planEnd(storedDates(items.get(draft.id) ?? [])) ?? draft.startDate, names) : null,
    chapters: loaded.chapters.map(({ code, name }) => ({ code, name })),
    copyFrom,
    today: loaded.today,
  };
}

/** The tenant's other projects with a baseline, to copy one from. */
function otherBaselines(tenantId: string, projectId: string) {
  return db
    .select({ projectId: projects.id, ref: projects.ref })
    .from(planningVersions)
    .innerJoin(projects, eq(projects.id, planningVersions.projectId))
    .where(
      and(
        eq(planningVersions.tenantId, tenantId),
        eq(planningVersions.status, "approved"),
        ne(planningVersions.projectId, projectId),
      ),
    )
    .orderBy(asc(projects.ref));
}

/** The open draft, recomputed as of today, against the baseline. */
export async function getPlanningDraft(ctx: Ctx, projectId: string): Promise<PlanningDraft> {
  const [loaded, { versions, draft, approved }] = await Promise.all([
    loadProject(ctx.tenantId, projectId),
    loadVersions(ctx.tenantId, projectId),
  ]);
  if (!draft) fail("not_found");
  const [items, names] = await Promise.all([loadItems([draft, approved]), namesOf(ctx.tenantId, versions)]);
  const rows = items.get(draft.id) ?? [];
  const dates = scheduleNow(loaded, draft.startDate, calendarOf(draft), rows.map(toInput));
  return {
    ref: loaded.project.ref,
    version: summaryOf(draft, planEnd(dates) ?? draft.startDate, names),
    calendar: calendarOf(draft),
    rows: rowsOf(loaded, rows, dates, dates),
    baseline: approved
      ? { number: approved.number, ends: Object.fromEntries((items.get(approved.id) ?? []).map((r) => [r.chapterCode, r.plannedEnd])) }
      : null,
    completionDate: loaded.completionDate,
    contractCents: loaded.contractCents,
    today: loaded.today,
  };
}

/** Every version with its dates, newest first: to see what each change moved. */
export async function getPlanningVersions(ctx: Ctx, projectId: string): Promise<PlanningVersions> {
  const [project, { versions }, chapterNames] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    loadVersions(ctx.tenantId, projectId),
    // Only the names: the contract's lines, prices and hitos aren't needed here.
    db
      .selectDistinct({ code: budgetChapters.code, name: budgetChapters.name })
      .from(budgetChapters)
      .innerJoin(budgetRevisions, eq(budgetRevisions.id, budgetChapters.revisionId))
      .where(
        and(
          eq(budgetRevisions.projectId, projectId),
          eq(budgetRevisions.tenantId, ctx.tenantId),
          eq(budgetRevisions.status, "accepted"),
        ),
      ),
  ]);
  const [items, names] = await Promise.all([loadItems(versions), namesOf(ctx.tenantId, versions)]);
  const nameOf = new Map(chapterNames.map((c) => [c.code, c.name]));
  return {
    ref: project.ref,
    versions: versions.map((v) => {
      const rows = items.get(v.id) ?? [];
      return {
        ...summaryOf(v, planEnd(storedDates(rows)) ?? v.startDate, names),
        rows: rows.map((r) => ({
          code: r.chapterCode,
          name: nameOf.get(r.chapterCode) ?? r.chapterCode,
          plannedStart: r.plannedStart,
          plannedEnd: r.plannedEnd,
        })),
      };
    }),
  };
}

// ─── Writes ──────────────────────────────────────────────────────────────────

function parseCalendar(input: Record<string, unknown>, fallback?: PlanningCalendar): PlanningCalendar {
  const region = input.region === undefined ? (fallback?.region ?? null) : input.region;
  if (region !== null && !PLANNING_REGIONS.includes(region as PlanningRegion)) fail("invalid_input");
  const flag = (key: "augustClosure" | "christmasClosure") => {
    const value = input[key];
    if (value === undefined) return fallback?.[key] ?? true;
    if (typeof value !== "boolean") fail("invalid_input");
    return value;
  };
  return { region: region as PlanningRegion | null, augustClosure: flag("augustClosure"), christmasClosure: flag("christmasClosure") };
}

/**
 * Keeps `rules` for the contract's chapters, in the contract's order: a
 * chapter they lack gets the standard rule; one the contract dropped goes, and
 * so does a dependency on it.
 */
function fitToContract(rules: PlanningItemInput[], codes: string[]): PlanningItemInput[] {
  const present = new Set(codes);
  const known = new Map(rules.map((r) => [r.code, r]));
  const template = new Map(templateItems(codes).map((r) => [r.code, r]));
  return codes.map((code) => {
    const rule = known.get(code) ?? template.get(code)!;
    return rule.after && !present.has(rule.after) ? { ...rule, after: null, lagDays: 0 } : rule;
  });
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Replaces a version's items with `rules` and the dates they give. */
async function writeItems(tx: Tx, tenantId: string, versionId: string, rules: PlanningItemInput[], dates: Map<string, Dates>) {
  await tx.delete(planningItems).where(eq(planningItems.versionId, versionId));
  if (rules.length === 0) return;
  await tx.insert(planningItems).values(
    rules.map((rule, position) => ({
      tenantId,
      versionId,
      chapterCode: rule.code,
      position,
      afterCode: rule.after,
      lagDays: rule.lagDays,
      durationDays: rule.durationDays,
      fixedStart: rule.fixedStart,
      spansWorks: rule.spansWorks,
      leadDays: rule.leadDays,
      plannedStart: dates.get(rule.code)!.start,
      plannedEnd: dates.get(rule.code)!.end,
    })),
  );
}

/**
 * Opens a draft: a copy of the baseline (`from: "baseline"`), or a first plan
 * from the standard template or another project's baseline, starting on
 * `startDate` (default: the project's start) with the calendar given.
 */
export async function createPlanningDraft(
  ctx: Ctx,
  projectId: string,
  input: unknown,
): Promise<{ versionId: string; number: number }> {
  requireEditor(ctx);
  if (!isObject(input)) fail("invalid_input");
  const [loaded, { versions, draft, approved }] = await Promise.all([
    loadProject(ctx.tenantId, projectId),
    loadVersions(ctx.tenantId, projectId),
  ]);
  if (draft) fail("draft_exists");
  const codes = loaded.chapters.map((c) => c.code);
  if (codes.length === 0) fail("no_budget");

  let rules: PlanningItemInput[];
  let calendar: PlanningCalendar;
  let startDate: string;
  if (input.from === "baseline") {
    if (!approved) fail("not_found");
    rules = fitToContract(((await loadItems([approved])).get(approved.id) ?? []).map(toInput), codes);
    calendar = calendarOf(approved);
    startDate = approved.startDate;
  } else if (input.from === "template" || input.from === "project") {
    calendar = parseCalendar(input);
    const start = input.startDate ?? loaded.startDate;
    if (start === null || start === undefined || start === "") fail("missing_fields");
    startDate = calendarDate(start);
    if (input.from === "template") rules = templateItems(codes);
    else {
      if (typeof input.projectId !== "string" || input.projectId === projectId) fail("invalid_input");
      // Another project of the tenant, with a baseline.
      const source = (await loadVersions(ctx.tenantId, input.projectId)).approved;
      if (!source) fail("not_found");
      // Its fixed days belong to its own calendar: here those chapters start with the works.
      const copied = ((await loadItems([source])).get(source.id) ?? []).map((row) => ({ ...toInput(row), fixedStart: null }));
      rules = fitToContract(copied, codes);
    }
  } else fail("invalid_input");

  const problem = planProblem(rules);
  if (problem) fail(problem);
  const dates = scheduleNow(loaded, startDate, calendar, rules);
  const number = Math.max(0, ...versions.map((v) => v.number)) + 1;
  try {
    const versionId = await db.transaction(async (tx) => {
      const [version] = await tx
        .insert(planningVersions)
        .values({ tenantId: ctx.tenantId, projectId, number, startDate, ...calendar, createdById: ctx.userId })
        .returning({ id: planningVersions.id });
      await writeItems(tx, ctx.tenantId, version!.id, rules, dates);
      return version!.id;
    });
    return { versionId, number };
  } catch (error) {
    // Someone else opened one meanwhile (one draft per project, numbers unique).
    if (isUniqueViolation(error)) fail("draft_exists");
    throw error;
  }
}

/** A rule as staff sent it: `spansWorks` stays as the draft has it, and so does a lead time not sent. */
function parseItem(value: unknown, current: PlanningItemInput): PlanningItemInput {
  const { spansWorks } = current;
  if (!isObject(value) || typeof value.code !== "string") fail("invalid_input");
  const after = value.after === null || value.after === undefined || value.after === "" ? null : value.after;
  if (after !== null && typeof after !== "string") fail("invalid_input");
  const fixedStart = value.fixedStart === null || value.fixedStart === undefined || value.fixedStart === "" ? null : calendarDate(value.fixedStart);
  return {
    code: value.code,
    after: spansWorks ? null : after,
    lagDays: spansWorks || after === null ? 0 : integer(value.lagDays ?? 0, -250, 250),
    durationDays: spansWorks ? 1 : integer(value.durationDays, 1, 600),
    fixedStart: spansWorks || after !== null ? null : fixedStart,
    spansWorks,
    leadDays: spansWorks ? 0 : value.leadDays === undefined ? current.leadDays : integer(value.leadDays, 0, 365),
  };
}

/**
 * The open draft with what staff sent applied: its rules (`items`, every
 * chapter of it, in its order), start and calendar, each kept as stored when
 * not sent.
 */
async function editedDraft(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  const [loaded, { draft, approved }] = await Promise.all([
    loadProject(ctx.tenantId, projectId),
    loadVersions(ctx.tenantId, projectId),
  ]);
  if (!draft) fail("not_found");
  const current = ((await loadItems([draft])).get(draft.id) ?? []).map(toInput);
  let rules = current;
  if (input.items !== undefined) {
    if (!Array.isArray(input.items) || input.items.length !== current.length) fail("invalid_input");
    const byCode = new Map(current.map((rule) => [rule.code, rule]));
    rules = input.items.map((item: unknown) => {
      const rule = isObject(item) && typeof item.code === "string" ? byCode.get(item.code) : undefined;
      if (!rule) fail("invalid_input");
      return parseItem(item, rule);
    });
    const problem = planProblem(rules);
    if (problem) fail(problem);
  }
  const calendar = parseCalendar(input, calendarOf(draft));
  const startDate = input.startDate === undefined ? draft.startDate : calendarDate(input.startDate);
  return {
    draft,
    approved,
    rules,
    calendar,
    startDate,
    dates: scheduleNow(loaded, startDate, calendar, rules),
    completionDate: loaded.completionDate,
  };
}

/** Saves the draft's rules and calendar, and stores the dates they give as of today. */
export async function updatePlanningDraft(ctx: Ctx, projectId: string, input: unknown) {
  requireEditor(ctx);
  if (!isObject(input) || !Array.isArray(input.items)) fail("invalid_input");
  const { draft, rules, calendar, startDate, dates } = await editedDraft(ctx, projectId, input);
  await db.transaction(async (tx) => {
    await tx.update(planningVersions).set({ startDate, ...calendar }).where(eq(planningVersions.id, draft.id));
    await writeItems(tx, ctx.tenantId, draft.id, rules, dates);
  });
}

/**
 * Makes the draft the baseline, its dates recomputed as of today; the previous
 * baseline is superseded. A change needs its `reason`. Rules and a calendar
 * sent with it are saved first, in the same transaction: what staff see is
 * what is approved.
 */
export async function approvePlanningDraft(ctx: Ctx, projectId: string, input: unknown) {
  requireEditor(ctx);
  const body = isObject(input) ? input : {};
  // Before it changes: the handover the client was told.
  const [{ draft, approved, rules, calendar, startDate, dates, completionDate }, baseline] = await Promise.all([
    editedDraft(ctx, projectId, body),
    approvedPlanDates(ctx.tenantId, projectId),
  ]);
  const toldBefore = clientDates(baseline, { startDate: null, completionDate }).completionDate;
  let reason: string | null;
  if (approved) {
    if (typeof body.reason !== "string" || !body.reason.trim()) fail("change_reason_required");
    reason = requiredText(body.reason, MAX_REASON);
  } else reason = optionalText(body.reason, MAX_REASON);

  await db.transaction(async (tx) => {
    if (approved) {
      await tx.update(planningVersions).set({ status: "superseded" }).where(eq(planningVersions.id, approved.id));
    }
    await tx
      .update(planningVersions)
      .set({ status: "approved", startDate, ...calendar, reason, approvedById: ctx.userId, approvedAt: new Date() })
      .where(eq(planningVersions.id, draft.id));
    await writeItems(tx, ctx.tenantId, draft.id, rules, dates);
  });

  // The app shows the phases' dates and the handover (on Obra and Inicio).
  await markChanged(ctx.tenantId, projectId, ["obra", "project"]);
  const handover = clientDates(dates, { startDate: null, completionDate }).completionDate;
  if (handover && handover !== toldBefore) {
    await notifyProjectClient(ctx.tenantId, projectId, { kind: "delivery", date: handover });
  }
}

/** Throws the draft away; the baseline stays as it is. */
export async function discardPlanningDraft(ctx: Ctx, projectId: string) {
  requireEditor(ctx);
  const { draft } = await loadVersions(ctx.tenantId, projectId);
  if (!draft) fail("not_found");
  await db.delete(planningVersions).where(eq(planningVersions.id, draft.id));
}
