import {
  and,
  asc,
  type AnyColumn,
  budgetChapters,
  budgetRevisions,
  db,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  projects,
  subcontractorAssignments,
  subcontractorAudit,
  subcontractorDocumentVersions,
  subcontractorDocuments,
  subcontractors,
  subcontractorWorkers,
  users,
} from "@repo/db";
import { TEMPLATE_CHAPTERS } from "./budget-template";
import { todayInSpain } from "./obra-calc";
import { isCalendarDate } from "./calendar";
import type { Ctx } from "./context";
import {
  companyStatus,
  docState,
  isValid,
  standing,
  workerAccess,
  type CompanyStatusResult,
  type DocFacts,
  type DocumentRequirement,
  type ProjectOption,
  type RequirementId,
  type SubcontractorDoc,
  type SubcontractorDocVersion,
  type SubcontractorError,
  type WorkerAccess,
} from "./contract";
import { CoreError } from "./errors";
import { clippedText, MAX_TEXT, PHONE_PATTERN } from "./input";

// ─── Subcontractor network ────────────────────────────────────────────────────
// What the subcontractor services share: error codes, input parsing, the audit
// log, and the tenant's whole network (companies, workers, documents with their
// current version, assignments) loaded at once. A tenant has tens of companies,
// so statuses and access are worked out in memory with ./subcontractor-rules.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS: Record<SubcontractorError, number> = {
  missing_fields: 400,
  missing_dates: 400,
  missing_reason: 400,
  invalid_tax_id: 400,
  invalid_id_document: 400,
  invalid_postal_code: 400,
  invalid_email: 400,
  invalid_phone: 400,
  invalid_date: 400,
  invalid_number: 400,
  invalid_option: 400,
  invalid_requirement: 400,
  invalid_chapter: 400,
  permanent_exceeds_headcount: 400,
  self_employed_cannot_subcontract: 400,
  chain_too_deep: 400,
  tax_id_exists: 409,
  id_document_exists: 409,
  not_optional: 400,
  nothing_to_review: 409,
  missing_file: 400,
  file_too_large: 413,
  invalid_file_type: 400,
  project_not_found: 404,
  worker_not_found: 404,
  not_found: 404,
  forbidden: 403,
};

export function fail(code: SubcontractorError): never {
  throw new CoreError(code, STATUS[code]);
}

// ─── Input parsing ───────────────────────────────────────────────────────────
// Bodies come as JSON (API, the portal's wizard) or form values (strings).

/** Trimmed, cut at MAX_TEXT. */
export const str = (value: unknown) => clippedText(value, MAX_TEXT);

/** Trimmed text, or null when empty. */
export const optional = (value: unknown) => str(value) || null;

export const bool = (value: unknown) => value === true || value === "true" || value === "on" || value === "1";

/** A whole number ≥ 0, or null when empty. */
export function count(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 1_000_000) fail("invalid_number");
  return n;
}

/** YYYY-MM-DD, or null when empty. */
export function calendarDate(value: unknown): string | null {
  const raw = optional(value);
  if (raw !== null && !isCalendarDate(raw)) fail("invalid_date");
  return raw;
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  const raw = optional(value);
  if (raw === null) return null;
  if (!allowed.includes(raw as T)) fail("invalid_option");
  return raw as T;
}

/** A list of allowed values: a JSON array or a comma-separated string. */
export function listOf<T extends string>(value: unknown, allowed: readonly T[]): T[] {
  const items = Array.isArray(value) ? value : typeof value === "string" && value ? value.split(",") : [];
  const list = [...new Set(items.map((item) => str(item)).filter(Boolean))];
  if (list.some((item) => !allowed.includes(item as T))) fail("invalid_option");
  return list as T[];
}

export function phone(value: unknown): string | null {
  const raw = optional(value);
  if (raw !== null && !PHONE_PATTERN.test(raw)) fail("invalid_phone");
  return raw;
}

/** Applies the input's keys over `base`: an update may send only what changed. */
export function merged<T extends object>(input: Record<string, unknown>, base: T | undefined) {
  return (key: keyof T & string): unknown => (base && !(key in input) ? base[key] : input[key]);
}

// ─── Lookups ─────────────────────────────────────────────────────────────────

export async function requireCompany(ctx: Ctx, subcontractorId: string) {
  const [row] = await db
    .select()
    .from(subcontractors)
    .where(and(eq(subcontractors.id, subcontractorId), eq(subcontractors.tenantId, ctx.tenantId)));
  if (!row) fail("not_found");
  return row;
}

/** The tenant's worker, optionally only if they work for `subcontractorId`. */
export async function requireWorker(ctx: Ctx, workerId: string, subcontractorId?: string) {
  const [row] = await db
    .select()
    .from(subcontractorWorkers)
    .where(
      and(
        eq(subcontractorWorkers.id, workerId),
        eq(subcontractorWorkers.tenantId, ctx.tenantId),
        subcontractorId ? eq(subcontractorWorkers.subcontractorId, subcontractorId) : undefined,
      ),
    );
  if (!row) fail("worker_not_found");
  return row;
}

// ─── Audit ───────────────────────────────────────────────────────────────────

type Executor = Pick<typeof db, "insert">;

export async function audit(
  executor: Executor,
  ctx: Ctx,
  subcontractorId: string,
  action: string,
  detail: Record<string, unknown> = {},
  workerId: string | null = null,
) {
  await executor.insert(subcontractorAudit).values({
    tenantId: ctx.tenantId,
    subcontractorId,
    workerId,
    userId: ctx.userId,
    action,
    detail,
  });
}

/** The fields whose value changed, as `{ field: [before, after] }`. */
export function changes<T extends object>(before: T, after: T) {
  const diff: Record<string, [unknown, unknown]> = {};
  for (const key of Object.keys(after) as (keyof T & string)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) diff[key] = [before[key], after[key]];
  }
  return diff;
}

// ─── Loading ─────────────────────────────────────────────────────────────────

export type CompanyRow = typeof subcontractors.$inferSelect;
export type WorkerRow = typeof subcontractorWorkers.$inferSelect;
export type DocRow = typeof subcontractorDocuments.$inferSelect;
export type VersionRow = typeof subcontractorDocumentVersions.$inferSelect;
export type AssignmentRow = typeof subcontractorAssignments.$inferSelect;



/** Each document's latest version (or latest validated one), keyed by document id. */
async function latestVersions(tenantId: string, documentIds: string[] | undefined, validatedOnly: boolean) {
  if (documentIds?.length === 0) return new Map<string, VersionRow>();
  const v = subcontractorDocumentVersions;
  const rows = await db
    .selectDistinctOn([v.documentId])
    .from(v)
    .where(
      and(
        eq(v.tenantId, tenantId),
        documentIds ? inArray(v.documentId, documentIds) : undefined,
        validatedOnly ? and(isNotNull(v.reviewedAt), isNull(v.rejectReason)) : undefined,
      ),
    )
    .orderBy(v.documentId, desc(v.version));
  return new Map(rows.map((row) => [row.documentId, row]));
}

/** Everything of the tenant's network, optionally only one company's. */
export async function loadNetwork(tenantId: string, subcontractorId?: string) {
  const scoped = (tenantColumn: AnyColumn, subcontractorColumn: AnyColumn) =>
    and(eq(tenantColumn, tenantId), subcontractorId ? eq(subcontractorColumn, subcontractorId) : undefined);

  const [companies, workers, docs, assignments, projectRows] = await Promise.all([
    db
      .select()
      .from(subcontractors)
      .where(scoped(subcontractors.tenantId, subcontractors.id))
      .orderBy(asc(subcontractors.legalName)),
    db
      .select()
      .from(subcontractorWorkers)
      .where(scoped(subcontractorWorkers.tenantId, subcontractorWorkers.subcontractorId))
      .orderBy(asc(subcontractorWorkers.surnames), asc(subcontractorWorkers.firstName)),
    db
      .select()
      .from(subcontractorDocuments)
      .where(scoped(subcontractorDocuments.tenantId, subcontractorDocuments.subcontractorId)),
    db
      .select()
      .from(subcontractorAssignments)
      .where(scoped(subcontractorAssignments.tenantId, subcontractorAssignments.subcontractorId)),
    db
      .select({ id: projects.id, ref: projects.ref, address: projects.address, obraStage: projects.obraStage })
      .from(projects)
      .where(eq(projects.tenantId, tenantId))
      .orderBy(asc(projects.ref)),
  ]);
  const ids = subcontractorId ? docs.map((d) => d.id) : undefined;
  const [versions, validated] = await Promise.all([
    latestVersions(tenantId, ids, false),
    latestVersions(tenantId, ids, true),
  ]);
  return new Network(companies, workers, docs, versions, validated, assignments, projectRows, todayInSpain());
}

export type ProjectRow = { id: string; ref: string; address: string; obraStage: number };

/** Groups rows by a key, once. */
function groupBy<T>(rows: T[], key: (row: T) => string) {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

const ownerKey = (subcontractorId: string, workerId: string | null, projectId: string | null) =>
  `${subcontractorId}|${workerId ?? ""}|${projectId ?? ""}`;

export class Network {
  private readonly docsByKey = new Map<string, DocRow>();
  /** Each owner's (company, worker, or company on an obra) documents' facts, by requirement id. */
  private readonly factsByOwner = new Map<string, Map<string, DocFacts>>();
  private readonly statusCache = new Map<string, CompanyStatusResult>();
  private readonly accessCache = new Map<string, WorkerAccess>();
  private readonly workersBySubcontractor: Map<string, WorkerRow[]>;
  private readonly assignmentsBySubcontractor: Map<string, AssignmentRow[]>;
  readonly projectsById: Map<string, ProjectRow>;
  readonly workersById: Map<string, WorkerRow>;

  constructor(
    readonly companies: CompanyRow[],
    readonly workers: WorkerRow[],
    readonly docs: DocRow[],
    readonly versions: Map<string, VersionRow>,
    private readonly validatedVersions: Map<string, VersionRow>,
    readonly assignments: AssignmentRow[],
    readonly projects: ProjectRow[],
    readonly today: string,
  ) {
    for (const doc of docs) {
      this.docsByKey.set(`${ownerKey(doc.subcontractorId, doc.workerId, doc.projectId)}|${doc.requirementId}`, doc);
      const owner = ownerKey(doc.subcontractorId, doc.workerId, doc.projectId);
      const facts = this.factsByOwner.get(owner) ?? new Map<string, DocFacts>();
      facts.set(doc.requirementId, this.facts(doc)!);
      this.factsByOwner.set(owner, facts);
    }
    this.projectsById = new Map(projects.map((p) => [p.id, p]));
    this.workersById = new Map(workers.map((w) => [w.id, w]));
    this.workersBySubcontractor = groupBy(workers, (w) => w.subcontractorId);
    this.assignmentsBySubcontractor = groupBy(assignments, (a) => a.subcontractorId);
  }

  doc(subcontractorId: string, workerId: string | null, projectId: string | null, requirementId: string) {
    return this.docsByKey.get(`${ownerKey(subcontractorId, workerId, projectId)}|${requirementId}`);
  }

  facts(doc: DocRow | undefined): DocFacts | undefined {
    if (!doc) return undefined;
    const facts: DocFacts = { status: doc.status, expiresAt: this.versions.get(doc.id)?.expiresAt ?? null };
    const validated = this.validatedVersions.get(doc.id);
    if (validated && doc.status !== "validated") facts.previousValidUntil = validated.expiresAt;
    return facts;
  }

  /** The version that makes a document count today: the current one, or the validated one before a pending renewal. */
  validVersion(doc: DocRow): VersionRow | undefined {
    const current = this.versions.get(doc.id);
    if (isValid(docState(doc.requirementId, this.facts(doc), this.today).state)) return current;
    return isValid(standing(doc.requirementId, this.facts(doc), this.today)) ? this.validatedVersions.get(doc.id) : undefined;
  }

  /** The owner's documents' facts, by requirement id. */
  factsOf(subcontractorId: string, workerId: string | null, projectId: string | null = null): ReadonlyMap<string, DocFacts> {
    return this.factsByOwner.get(ownerKey(subcontractorId, workerId, projectId)) ?? new Map();
  }

  status(subcontractorId: string): CompanyStatusResult {
    let result = this.statusCache.get(subcontractorId);
    if (!result) {
      result = companyStatus(this.factsOf(subcontractorId, null), this.today);
      this.statusCache.set(subcontractorId, result);
    }
    return result;
  }

  workersOf(subcontractorId: string): WorkerRow[] {
    return this.workersBySubcontractor.get(subcontractorId) ?? [];
  }

  assignmentsOf(subcontractorId: string): AssignmentRow[] {
    return this.assignmentsBySubcontractor.get(subcontractorId) ?? [];
  }

  /** A worker's access anywhere (`assignment` null) or on one obra. */
  access(worker: WorkerRow, assignment: ObraContext | null = null): WorkerAccess {
    const key = `${worker.id}|${assignment?.projectId ?? ""}`;
    let result = this.accessCache.get(key);
    if (!result) {
      result = workerAccess({
        company: this.status(worker.subcontractorId).status,
        docs: this.factsOf(worker.subcontractorId, worker.id),
        roles: worker.roles,
        obra: assignment && {
          pssAdhesion: this.facts(this.doc(assignment.subcontractorId, null, assignment.projectId, "adhesion_pss")),
          bookEntry: hasBookEntry(assignment),
          chapterCodes: assignment.chapterCodes,
        },
        today: this.today,
      });
      this.accessCache.set(key, result);
    }
    return result;
  }

  /** Whether the assignment is running today (no dates means it is). */
  isCurrent(assignment: AssignmentRow) {
    const { plannedStart, plannedEnd } = assignment;
    return (!plannedStart || plannedStart <= this.today) && (!plannedEnd || this.today <= plannedEnd);
  }
}

/** What a worker's access on an obra needs of the company's assignment there. */
export type ObraContext = Pick<AssignmentRow, "subcontractorId" | "projectId" | "chapterCodes" | "bookOrder" | "bookDate">;

export const hasBookEntry = (a: Pick<AssignmentRow, "bookOrder" | "bookDate">) => a.bookOrder !== null && a.bookDate !== null;


// ─── Documents as the API shows them ─────────────────────────────────────────

/** Names of the users who uploaded or reviewed `versions`. */
export async function userNames(tenantId: string, versions: VersionRow[]) {
  const ids = [
    ...new Set(versions.flatMap((v) => [v.uploadedById, v.reviewedById]).filter((id): id is string => !!id)),
  ];
  if (ids.length === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(and(eq(users.tenantId, tenantId), inArray(users.id, ids)));
  return new Map(rows.map((u) => [u.id, u.name ?? u.email]));
}

export function toVersion(row: VersionRow, names: Map<string, string>): SubcontractorDocVersion {
  const name = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  return {
    id: row.id,
    version: row.version,
    filename: row.filename,
    sizeBytes: row.sizeBytes,
    issuedAt: row.issuedAt,
    expiresAt: row.expiresAt,
    uploadedBy: name(row.uploadedById),
    uploadedAt: row.createdAt.toISOString(),
    outcome: row.reviewedAt ? (row.rejectReason ? "rejected" : "validated") : null,
    reviewedBy: name(row.reviewedById),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    rejectReason: row.rejectReason,
  };
}

export function toDoc(
  req: DocumentRequirement,
  owner: { workerId: string | null; projectId: string | null },
  doc: DocRow | undefined,
  versions: VersionRow[],
  names: Map<string, string>,
  today: string,
): SubcontractorDoc {
  const current = versions[0];
  const { state, daysLeft } = docState(
    req.id,
    doc && { status: doc.status, expiresAt: current?.expiresAt ?? null },
    today,
  );
  return {
    id: doc?.id ?? null,
    requirementId: req.id as RequirementId,
    workerId: owner.workerId,
    projectId: owner.projectId,
    status: doc?.status ?? null,
    state,
    daysLeft,
    issuedAt: current?.issuedAt ?? null,
    expiresAt: current?.expiresAt ?? null,
    notApplicableReason: doc?.notApplicableReason ?? null,
    requestedAt: doc?.requestedAt?.toISOString() ?? null,
    current: current ? toVersion(current, names) : null,
    versions: versions.map((v) => toVersion(v, names)),
  };
}

/** Every version of the given documents, newest first, by document id. */
export async function allVersions(tenantId: string, documentIds: string[]) {
  const byDoc = new Map<string, VersionRow[]>();
  if (documentIds.length === 0) return byDoc;
  const rows = await db
    .select()
    .from(subcontractorDocumentVersions)
    .where(
      and(
        eq(subcontractorDocumentVersions.tenantId, tenantId),
        inArray(subcontractorDocumentVersions.documentId, documentIds),
      ),
    )
    .orderBy(desc(subcontractorDocumentVersions.version));
  for (const row of rows) byDoc.set(row.documentId, [...(byDoc.get(row.documentId) ?? []), row]);
  return byDoc;
}

// ─── Obras ───────────────────────────────────────────────────────────────────

/**
 * The tenant's projects to assign companies to, each with the chapters of its
 * accepted budget (the FRAMER template's when it has none yet).
 */
export async function projectOptions(tenantId: string, rows: ProjectRow[]): Promise<ProjectOption[]> {
  const chapters = await db
    .select({ projectId: budgetRevisions.projectId, code: budgetChapters.code, name: budgetChapters.name })
    .from(budgetChapters)
    .innerJoin(budgetRevisions, eq(budgetRevisions.id, budgetChapters.revisionId))
    .where(
      and(
        eq(budgetRevisions.tenantId, tenantId),
        eq(budgetRevisions.status, "accepted"),
        eq(budgetChapters.kind, "chapter"),
      ),
    )
    .orderBy(asc(budgetChapters.position));
  return rows.map((p) => {
    const own = chapters.filter((c) => c.projectId === p.id).map(({ code, name }) => ({ code, name }));
    return { ...p, chapters: own.length > 0 ? own : TEMPLATE_CHAPTERS };
  });
}
