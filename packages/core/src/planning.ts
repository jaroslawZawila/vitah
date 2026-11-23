import { and, asc, budgetChapters, budgetRevisions, db, desc, eq, inArray, ne, planningItems, planningVersions, projects } from "@repo/db";
import { isUniqueViolation } from "./accounts";
import { markChanged } from "./changes";
import { requireEditor, type Ctx } from "./context";
import {
  CONTINGENCY_CHAPTER,
  type ObraStage,
  type PlanningCalendar,
  type PlanningDraft,
  type PlanningItemInput,
  type PlanningRegion,
  type PlanningRow,
  type PlanningVersions,
  type PlanningVersionSummary,
  type ProjectPlanning,
  type ScheduleStatus,
} from "./contract";
import { toCalendarDate } from "./calendar";
import { chapterState, contractSchedule } from "./control-calc";
import { notifyProjectClient } from "./notifications";
import { parse } from "./inputs/fields";
import {
  newPlanningSchemas,
  planningBodySchema,
  planningEditSchema,
  planningReasonSchemas,
  planningRuleSchemas,
  planningSaveSchema,
  planningSourceSchema,
} from "./inputs/planning";
import { todayInSpain } from "./obra-calc";
import { fail, loadObra, requireProject, userNamesById } from "./obra-data";
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
import { projectInTenant, projectNotDeleted } from "./project-client";
import { scheduleStatus } from "./schedule-status";

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

type Obra = Awaited<ReturnType<typeof loadObra>>;
type Works = { startDate: string | null; completionDate: string | null };

/** What the plan is measured with: what Avance recorded, today, and the contract's end. */
type Measure = { recorded: ReadonlyMap<string, Recorded>; today: string; completionDate: string | null };

const recordedOf = (obra: Pick<Obra, "progressRows">) =>
  new Map<string, Recorded>(obra.progressRows.map((r) => [r.chapterCode, { actualStart: r.actualStart, actualEnd: r.actualEnd }]));

/** The project, its contract's chapters (chapter 20 aside) and what Avance recorded. */
async function loadProject(tenantId: string, projectId: string) {
  const [project, obra] = await Promise.all([requireProject(tenantId, projectId), loadObra(tenantId, projectId)]);
  const hitoOf = new Map(obra.hitos.flatMap((h) => h.chapters.map((c) => [c.code, h.code] as const)));
  const progressOf = new Map(obra.chapters.map((c) => [c.code, c.progressPct]));
  const chapters = obra.costChapters
    .filter((c) => c.code !== CONTINGENCY_CHAPTER)
    .map((c) => ({ code: c.code, name: c.name, hitoCode: hitoOf.get(c.code) ?? null, progressPct: progressOf.get(c.code) ?? 0 }));
  return {
    project,
    obra,
    stage: project.obraStage as ObraStage,
    startDate: toCalendarDate(project.startDate),
    completionDate: toCalendarDate(project.completionDate),
    chapters,
    recorded: recordedOf(obra),
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
const scheduleNow = (measure: Measure, startDate: string, calendar: PlanningCalendar, rules: PlanningItemInput[]) =>
  schedulePlan(rules, { startDate, calendar, recorded: measure.recorded, today: measure.today });

/** The baseline's stored dates, where it is heading as of today, and both against the contract. */
function baselineForecast(measure: Measure, approved: VersionRow, rows: ItemRow[]) {
  const planned = storedDates(rows);
  const forecast = scheduleNow(measure, approved.startDate, calendarOf(approved), rows.map(toInput));
  const plannedEnd = planEnd(planned) ?? approved.startDate;
  return {
    planned,
    forecast,
    plannedEnd,
    plannedCheck: planCheck(plannedEnd, measure.completionDate),
    forecastCheck: planCheck(planEnd(forecast) ?? plannedEnd, measure.completionDate),
  };
}

/** What the schedule reads of an obra: `loadObra`'s, or the project list's `loadObraSummaries`. */
type ScheduleObra = Pick<Obra, "progressRows" | "planDates" | "plan"> & {
  costChapters: { code: string; name: string }[];
  hitos: { pctBp: number; chapters: { code: string }[] }[];
};

/** The contract's chapters with their states and planned dates (control-calc's `contractSchedule`). */
export function obraContract<C extends { code: string; name: string }>(obra: ScheduleObra & { costChapters: C[] }, works: Works) {
  return contractSchedule(obra.costChapters, obra.hitos, obra.progressRows, works, obra.planDates);
}

type Contract = Pick<ReturnType<typeof obraContract<{ code: string; name: string }>>, "items" | "states" | "plan" | "planSource">;

/** The status from the contract's chapters (Avance's states, the baseline's dates or simulated ones) and the forecast. */
function statusOf(
  { items, states, plan, planSource }: Contract,
  today: string,
  forecast: ScheduleStatus["forecast"],
): ScheduleStatus {
  const chapters = items.map(({ code, name }) => ({
    code,
    name,
    state: states.get(code)!,
    plannedStart: plan.get(code)?.start ?? null,
    plannedEnd: plan.get(code)?.end ?? null,
  }));
  return scheduleStatus({ chapters, planning: planSource, forecast, today });
}

/**
 * Whether the obra is on time (./schedule-status), from its `obra` (with its
 * approved baseline, read with it) and the project's contract dates: what Obra
 * › Resumen and the project list state, the same as Planificación's
 * `schedule`. `contract` is `obraContract(obra, works)`, when the caller has
 * it already.
 */
export function obraSchedule(obra: ScheduleObra, works: Works, today: string, contract: Contract = obraContract(obra, works)): ScheduleStatus {
  const measure = { recorded: recordedOf(obra), today, completionDate: works.completionDate };
  const forecast = obra.plan ? baselineForecast(measure, obra.plan.version, obra.plan.items).forecastCheck : null;
  return statusOf(contract, today, forecast);
}

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
  const [loaded, { versions, draft }] = await Promise.all([
    loadProject(ctx.tenantId, projectId),
    loadVersions(ctx.tenantId, projectId),
  ]);
  const [items, names, copyFrom] = await Promise.all([
    loadItems([draft]),
    namesOf(ctx.tenantId, versions),
    otherBaselines(ctx.tenantId, projectId),
  ]);

  // The baseline as `loadObra` read it, with its items: the one Resumen measures too.
  const approved = loaded.obra.plan?.version;
  let baseline: ProjectPlanning["baseline"] = null;
  if (approved) {
    const rows = loaded.obra.plan!.items;
    const { planned, forecast, plannedEnd, plannedCheck, forecastCheck } = baselineForecast(loaded, approved, rows);
    baseline = {
      ...summaryOf(approved, plannedEnd, names),
      calendar: calendarOf(approved),
      rows: rowsOf(loaded, rows, planned, forecast),
      planned: plannedCheck,
      forecast: forecastCheck,
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
    schedule: statusOf(obraContract(loaded.obra, loaded), loaded.today, baseline?.forecast ?? null),
  };
}

/** The tenant's other projects (not deleted) with a baseline, to copy one from. */
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
        projectNotDeleted(),
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

/** The calendar sent (as parsed), each part `fallback`'s when not sent: national holidays and both closures without one. */
function calendarFrom(sent: Partial<PlanningCalendar>, fallback?: PlanningCalendar): PlanningCalendar {
  return {
    region: sent.region === undefined ? (fallback?.region ?? null) : sent.region,
    augustClosure: sent.augustClosure ?? fallback?.augustClosure ?? true,
    christmasClosure: sent.christmasClosure ?? fallback?.christmasClosure ?? true,
  };
}

/**
 * Keeps `rules` for the contract's chapters, in the order staff gave them. A
 * chapter they lack gets the standard rule, placed after the chapter before it
 * in the contract (one that spans the works, at the end): a plan never
 * reordered stays in the contract's order. A chapter the contract dropped
 * goes, and so does a dependency on it.
 */
function fitToContract(rules: PlanningItemInput[], codes: string[]): PlanningItemInput[] {
  const present = new Set(codes);
  const known = new Set(rules.map((r) => r.code));
  const fitted = rules.filter((r) => present.has(r.code));
  const template = templateItems(codes);
  template.forEach((rule, index) => {
    if (known.has(rule.code)) return;
    let at = fitted.length;
    if (!rule.spansWorks) {
      let before = index - 1;
      while (template[before]?.spansWorks) before--;
      at = before < 0 ? 0 : fitted.findIndex((r) => r.code === template[before]!.code) + 1;
    }
    fitted.splice(at, 0, rule);
  });
  return fitted.map((rule) => (rule.after && !present.has(rule.after) ? { ...rule, after: null, lagDays: 0 } : rule));
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
  parse(planningBodySchema, input);
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
  const { from } = parse(planningSourceSchema, input);
  if (from === "baseline") {
    if (!approved) fail("not_found");
    rules = fitToContract(((await loadItems([approved])).get(approved.id) ?? []).map(toInput), codes);
    calendar = calendarOf(approved);
    startDate = approved.startDate;
  } else {
    const { startDate: start, projectId: sourceId, ...sent } =
      from === "project" ? parse(newPlanningSchemas.project, input) : { ...parse(newPlanningSchemas.template, input), projectId: null };
    calendar = calendarFrom(sent);
    const day = start ?? loaded.startDate;
    if (!day) fail("missing_fields");
    startDate = day;
    if (sourceId === null) rules = templateItems(codes);
    else {
      if (sourceId === projectId) fail("invalid_input");
      // Another project of the tenant (not a deleted one), with a baseline.
      const [other, { approved: source }] = await Promise.all([
        db.query.projects.findFirst({ where: projectInTenant(ctx.tenantId, sourceId), columns: { id: true } }),
        loadVersions(ctx.tenantId, sourceId),
      ]);
      if (!other || !source) fail("not_found");
      // Its fixed days belong to its own calendar: here those chapters start with the works.
      const copied = ((await loadItems([source])).get(source.id) ?? []).map((row) => ({ ...toInput(row), fixedStart: null }));
      rules = fitToContract(copied, codes);
    }
  }

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

/**
 * A rule as staff sent it (`planningRuleSchemas`, by what it is): `spansWorks`
 * stays as the draft has it, and so does a lead time not sent.
 */
function ruleOf(item: unknown, current: PlanningItemInput): PlanningItemInput {
  const { spansWorks } = current;
  const { code, after, fixedStart } = parse(planningRuleSchemas.head, item);
  if (spansWorks) return { code, after: null, lagDays: 0, durationDays: 1, fixedStart: null, spansWorks, leadDays: 0 };
  const rule = after === null ? { ...parse(planningRuleSchemas.own, item), lagDays: 0 } : parse(planningRuleSchemas.after, item);
  return {
    code,
    after,
    lagDays: rule.lagDays,
    durationDays: rule.durationDays,
    fixedStart: after === null ? fixedStart : null,
    spansWorks,
    leadDays: rule.leadDays ?? current.leadDays,
  };
}

/**
 * The open draft with what staff sent applied: its rules (`items`, every
 * chapter of it; the order sent becomes the plan's order), start and
 * calendar, each kept as stored when not sent.
 */
async function editedDraft(ctx: Ctx, projectId: string, input: unknown) {
  const [loaded, { draft, approved }] = await Promise.all([
    loadProject(ctx.tenantId, projectId),
    loadVersions(ctx.tenantId, projectId),
  ]);
  if (!draft) fail("not_found");
  const { items, startDate: start, ...sent } = parse(planningEditSchema, input);
  const current = ((await loadItems([draft])).get(draft.id) ?? []).map(toInput);
  let rules = current;
  if (items) {
    if (items.length !== current.length) fail("invalid_input");
    const byCode = new Map(current.map((rule) => [rule.code, rule]));
    rules = items.map((item) => ruleOf(item, byCode.get(item.code) ?? fail("invalid_input")));
    const problem = planProblem(rules);
    if (problem) fail(problem);
  }
  const calendar = calendarFrom(sent, calendarOf(draft));
  const startDate = start ?? draft.startDate;
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
  parse(planningSaveSchema, input);
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
  // Not an object: nothing sent with it.
  const body = planningBodySchema.safeParse(input).success ? input : {};
  // Before it changes: the handover the client was told.
  const [{ draft, approved, rules, calendar, startDate, dates, completionDate }, baseline] = await Promise.all([
    editedDraft(ctx, projectId, body),
    approvedPlanDates(ctx.tenantId, projectId),
  ]);
  const toldBefore = clientDates(baseline, { startDate: null, completionDate }).completionDate;
  const { reason } = parse(approved ? planningReasonSchemas.change : planningReasonSchemas.first, body);

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
  const [, { draft }] = await Promise.all([requireProject(ctx.tenantId, projectId), loadVersions(ctx.tenantId, projectId)]);
  if (!draft) fail("not_found");
  await db.delete(planningVersions).where(eq(planningVersions.id, draft.id));
}
