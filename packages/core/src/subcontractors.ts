import { Zip, ZipPassThrough } from "fflate";
import {
  and,
  db,
  desc,
  asc,
  eq,
  inArray,
  isNull,
  lte,
  projects,
  subcontractorAssignments,
  subcontractorAudit,
  subcontractorDocumentVersions,
  subcontractorDocuments,
  subcontractors,
  subcontractorWorkers,
  users,
} from "@repo/db";
import { EMAIL_PATTERN, isUniqueViolation } from "./accounts";
import { canEdit, requireEditor, type Ctx } from "./context";
import {
  BUDGET_CHAPTER_CODES,
  DOC_PILLARS,
  MACHINERY,
  MANDATORY_COMPANY_REQUIREMENTS,
  MAX_CHAIN_LEVEL,
  PREVENTION_MODES,
  SUBCONTRACTOR_KINDS,
  SUBCONTRACTOR_TRADES,
  defaultExpiry,
  docState,
  isValid,
  isValidCif,
  isValidPersonalId,
  lowPermanentShare,
  maskIdNumber,
  normalizeIdNumber,
  provinceForPostalCode,
  requirement,
  requirementsFor,
  EXECUTION_STAGE,
  worstBadge,
  workerName,
  type AttentionItem,
  type DocBadge,
  type DocumentRequirement,
  type DocPillar,
  type DocState,
  type Region,
  type RequirementId,
  type SubcontractorAssignment,
  type SubcontractorAuditEntry,
  type SubcontractorCounts,
  type SubcontractorDetail,
  type SubcontractorFields,
  type SubcontractorListItem,
  type SubcontractorsOverview,
} from "./contract";
import { requirePdf } from "./documents";
import { addDays, todayInSpain } from "./obra-calc";
import { projectInTenant } from "./project-client";
import { openStoredFile, storeFiles, type StoredFile } from "./project-files";
import { readFile } from "./storage";
import {
  allVersions,
  audit,
  bool,
  calendarDate,
  changes,
  count,
  fail,
  listOf,
  loadNetwork,
  merged,
  oneOf,
  optional,
  phone,
  projectOptions,
  requireCompany,
  requireWorker,
  str,
  toDoc,
  userNames,
  type CompanyRow,
  type Network,
} from "./subcontractor-network";
import { workerListItem } from "./subcontractor-workers";

// ─── Subcontractors ───────────────────────────────────────────────────────────
// The companies (and self-employed) working on the tenant's obras, their CAE
// documents and their obra assignments. A company's status and its workers'
// access are computed from the documents, never stored
// (./subcontractor-rules.ts). Every staff member reads; admins and managers
// (the contractor and the jefe de obra) create, edit, validate and reject.
// Every write is in the company's audit log. Documents are versioned: an
// upload adds a version and never replaces an older one.
// ─────────────────────────────────────────────────────────────────────────────

/** The company fields from `input`; an update passes the current ones as `base`. */
function parseFields(input: Record<string, unknown>, base?: SubcontractorFields): SubcontractorFields & { reaRegion: Region } {
  const get = merged(input, base);
  const kind = oneOf(get("kind"), SUBCONTRACTOR_KINDS);
  const legalName = str(get("legalName"));
  const taxId = normalizeIdNumber(str(get("taxId")));
  const address = str(get("address"));
  const postalCode = str(get("postalCode"));
  const city = str(get("city"));
  if (!kind || !legalName || !taxId || !address || !postalCode || !city) fail("missing_fields");

  if (!(kind === "company" ? isValidCif(taxId) : isValidPersonalId(taxId))) fail("invalid_tax_id");
  const place = provinceForPostalCode(postalCode);
  if (!place) fail("invalid_postal_code");
  const email = optional(get("email"))?.toLowerCase() ?? null;
  if (email !== null && !EMAIL_PATTERN.test(email)) fail("invalid_email");

  const headcount = count(get("headcount"));
  const permanentCount = count(get("permanentCount"));
  if (headcount !== null && permanentCount !== null && permanentCount > headcount) {
    fail("permanent_exceeds_headcount");
  }
  const subcontractsFurther = bool(get("subcontractsFurther"));
  if (subcontractsFurther && kind === "self_employed") fail("self_employed_cannot_subcontract");
  const chainLevel = count(get("chainLevel")) ?? 1;
  if (chainLevel < 1 || chainLevel > MAX_CHAIN_LEVEL || (subcontractsFurther && chainLevel === MAX_CHAIN_LEVEL)) {
    fail("chain_too_deep");
  }
  const isInstaller = bool(get("isInstaller"));

  return {
    kind,
    legalName,
    taxId,
    address,
    postalCode,
    city,
    // A new postal code brings its own province unless one is given with it.
    province: ("province" in input || !base || base.postalCode === postalCode ? str(get("province")) : "") || place.province,
    reaRegion: place.region,
    reaNumber: optional(get("reaNumber")),
    phone: phone(get("phone")),
    email,
    legalRep: optional(get("legalRep")),
    siteContact: optional(get("siteContact")),
    siteContactPhone: phone(get("siteContactPhone")),
    trades: listOf(get("trades"), SUBCONTRACTOR_TRADES),
    isInstaller,
    installerReg: isInstaller ? optional(get("installerReg")) : null,
    headcount,
    permanentCount,
    subcontractsFurther,
    chainLevel,
    preventionMode: oneOf(get("preventionMode"), PREVENTION_MODES),
    preventionEntity: optional(get("preventionEntity")),
    preventionValidUntil: calendarDate(get("preventionValidUntil")),
    machinery: listOf(get("machinery"), MACHINERY),
  };
}

function fieldsOf(row: CompanyRow): SubcontractorFields {
  const { id: _, tenantId: __, reaRegion: ___, createdAt: ____, updatedAt: _____, ...fields } = row;
  return fields;
}

// ─── Companies ───────────────────────────────────────────────────────────────

/** Body: SubcontractorFields (the REA region comes from the postal code). */
/**
 * Body: SubcontractorFields (the REA region comes from the postal code), plus
 * what the registration wizard collects with them: `assignment` ({ projectId,
 * …assignToProject's body }) and `notApplicable` ([{ requirementId, reason }]
 * for optional documents). All in one go; the files follow one per request.
 */
export async function createSubcontractor(ctx: Ctx, input: Record<string, unknown>) {
  requireEditor(ctx);
  const fields = parseFields(input);
  const assignment = isObject(input.assignment) ? input.assignment : null;
  const project = assignment ? await requireProjectRef(ctx, str(assignment.projectId)) : null;
  const assigned = assignment && assignmentValues(assignment);
  // One entry per document: the last reason given wins.
  const notApplicable = [
    ...new Map(
      (Array.isArray(input.notApplicable) ? input.notApplicable : [])
        .filter(isObject)
        .map((entry) => notApplicableEntry(entry))
        .map((entry) => [entry.id, entry]),
    ).values(),
  ];
  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(subcontractors)
        .values({ ...fields, tenantId: ctx.tenantId })
        .returning({ id: subcontractors.id });
      const id = row!.id;
      await audit(tx, ctx, id, "created", { legalName: fields.legalName });
      if (project && assigned) await saveAssignment(tx, ctx, id, project, assigned);
      for (const entry of notApplicable) await saveNotApplicable(tx, ctx, id, entry, undefined);
      return id;
    });
    return { id };
  } catch (error) {
    if (isUniqueViolation(error, "subcontractors_tenant_tax_id_unique")) fail("tax_id_exists");
    throw error;
  }
}

/** Body: any of SubcontractorFields. Each changed field is logged. */
export async function updateSubcontractor(ctx: Ctx, subcontractorId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const row = await requireCompany(ctx, subcontractorId);
  const before = fieldsOf(row);
  const { reaRegion, ...after } = parseFields(input, before);
  const diff = changes(before, after);
  if (Object.keys(diff).length === 0) return { id: subcontractorId };
  try {
    await db.transaction(async (tx) => {
      await tx
        .update(subcontractors)
        .set({ ...after, reaRegion })
        .where(and(eq(subcontractors.id, subcontractorId), eq(subcontractors.tenantId, ctx.tenantId)));
      await audit(tx, ctx, subcontractorId, "updated", { fields: diff });
    });
  } catch (error) {
    if (isUniqueViolation(error, "subcontractors_tenant_tax_id_unique")) fail("tax_id_exists");
    throw error;
  }
  return { id: subcontractorId };
}

const PILLAR_REQUIREMENTS: Record<DocPillar, RequirementId[]> = {
  rea: ["rea_subcontrata"],
  aeat: ["cert_aeat_contratistas"],
  ss: ["cert_tgss", "rnt_mensual"],
  rc: ["poliza_rc_subcontrata"],
  prl: ["concierto_spa", "evaluacion_riesgos"],
};

function listItem(net: Network, row: CompanyRow): SubcontractorListItem {
  const badge = (id: RequirementId): DocBadge => docState(id, net.facts(net.doc(row.id, null, null, id)), net.today);
  const status = net.status(row.id);
  const pillars = Object.fromEntries(
    DOC_PILLARS.map((pillar) => [pillar, worstBadge(PILLAR_REQUIREMENTS[pillar].map(badge))]),
  ) as Record<DocPillar, DocBadge>;
  return {
    id: row.id,
    kind: row.kind,
    legalName: row.legalName,
    taxIdMasked: maskIdNumber(row.taxId),
    reaRegion: row.reaRegion as Region,
    trades: row.trades,
    status: status.status,
    pillars,
    docsTotal: MANDATORY_COMPANY_REQUIREMENTS.length,
    docsValid: MANDATORY_COMPANY_REQUIREMENTS.length - status.expired.length - status.pending.length,
    workers: net.workersOf(row.id).length,
    projectIds: net.assignmentsOf(row.id).map((a) => a.projectId),
  };
}

/** The tenant's companies to pick from (a worker's company, a list filter). */
export function listCompanyOptions(ctx: Ctx) {
  return db
    .select({ id: subcontractors.id, legalName: subcontractors.legalName, kind: subcontractors.kind })
    .from(subcontractors)
    .where(eq(subcontractors.tenantId, ctx.tenantId))
    .orderBy(asc(subcontractors.legalName));
}

export async function listSubcontractors(ctx: Ctx): Promise<SubcontractorListItem[]> {
  const net = await loadNetwork(ctx.tenantId);
  return net.companies.map((row) => listItem(net, row));
}

// What needs doing first: expired, rejected, missing, awaiting validation,
// requested, then expiring soonest.
const ATTENTION_ORDER: DocState[] = ["expired", "rejected", "missing", "uploaded", "requested", "expiring"];

function attentionItems(net: Network): AttentionItem[] {
  const companies = new Map(net.companies.map((c) => [c.id, c]));
  const workers = new Map(net.workers.map((w) => [w.id, w]));
  const items: AttentionItem[] = [];

  for (const doc of net.docs) {
    const req = requirement(doc.requirementId);
    const company = companies.get(doc.subcontractorId);
    if (!req || !company) continue;
    const version = net.versions.get(doc.id);
    const { state, daysLeft } = docState(req.id, net.facts(doc), net.today);
    // Every row exists, so "missing" only comes from the loop below.
    if (!ATTENTION_ORDER.includes(state)) continue;
    const worker = doc.workerId ? workers.get(doc.workerId) : undefined;
    const date =
      state === "expired" || state === "expiring"
        ? (version?.expiresAt ?? null)
        : state === "uploaded"
          ? (version?.createdAt.toISOString().slice(0, 10) ?? null)
          : (doc.requestedAt?.toISOString().slice(0, 10) ?? null);
    const companyDoc = !doc.workerId && !doc.projectId;
    items.push({
      subcontractorId: company.id,
      subcontractorName: company.legalName,
      workerId: worker?.id ?? null,
      workerName: worker ? workerName(worker) : null,
      projectId: doc.projectId,
      projectRef: doc.projectId ? (net.projectsById.get(doc.projectId)?.ref ?? null) : null,
      documentId: doc.id,
      requirementIds: [req.id as RequirementId],
      state,
      daysLeft,
      date,
      affectedWorkers: state === "expired" && companyDoc && req.mandatory ? net.workersOf(company.id).length : 0,
    });
  }

  // Missing mandatory documents: one line per company, one per obra without its PSS adhesion.
  for (const company of net.companies) {
    const missing = MANDATORY_COMPANY_REQUIREMENTS.filter((r) => !net.doc(company.id, null, null, r.id)).map(
      (r) => r.id,
    );
    if (missing.length > 0) {
      items.push(missingItem(company, missing, null));
    }
    for (const a of net.assignmentsOf(company.id)) {
      if (!net.doc(company.id, null, a.projectId, "adhesion_pss")) {
        items.push(missingItem(company, ["adhesion_pss"], net.projectsById.get(a.projectId) ?? null));
      }
    }
  }

  return items.sort(
    (a, b) =>
      ATTENTION_ORDER.indexOf(a.state) - ATTENTION_ORDER.indexOf(b.state) ||
      (a.daysLeft ?? 0) - (b.daysLeft ?? 0) ||
      a.subcontractorName.localeCompare(b.subcontractorName),
  );
}

function missingItem(
  company: CompanyRow,
  requirementIds: RequirementId[],
  project: { id: string; ref: string } | null,
): AttentionItem {
  return {
    subcontractorId: company.id,
    subcontractorName: company.legalName,
    workerId: null,
    workerName: null,
    projectId: project?.id ?? null,
    projectRef: project?.ref ?? null,
    documentId: null,
    requirementIds,
    state: "missing",
    daysLeft: null,
    date: null,
    affectedWorkers: 0,
  };
}

export async function getOverview(ctx: Ctx): Promise<SubcontractorsOverview> {
  const net = await loadNetwork(ctx.tenantId);
  const companies = net.companies.map((row) => listItem(net, row));

  const counts = { apta: 0, pendiente: 0, bloqueada: 0 };
  for (const c of companies) counts[c.status]++;

  const workers = { total: net.workers.length, ok: 0, pending: 0, blocked: 0 };
  for (const w of net.workers) {
    workers[net.access(w).status]++;
  }

  const { expiring, expired } = expiryCounts(net);

  const today = net.assignments.filter(
    (a) => net.projectsById.get(a.projectId)?.obraStage === EXECUTION_STAGE && net.isCurrent(a),
  );
  const onSite = new Set(today.map((a) => a.subcontractorId));
  const onSiteToday = {
    projectRefs: [...new Set(today.map((a) => net.projectsById.get(a.projectId)!.ref))].sort(),
    companies: onSite.size,
    // A worker on two obras today counts once.
    workers: new Set(
      today.flatMap((a) => net.workersOf(a.subcontractorId).filter((w) => net.access(w, a).status === "ok").map((w) => w.id)),
    ).size,
    blocked: net.companies
      .filter((c) => onSite.has(c.id) && net.status(c.id).status === "bloqueada")
      .map((c) => c.legalName),
  };

  return {
    companies,
    counts,
    workers,
    expiring,
    expired,
    onSiteToday,
    attention: attentionItems(net),
    projects: await projectOptions(ctx.tenantId, net.projects),
  };
}

/**
 * What needs attention among the companies working on one obra: their own
 * documents, their workers' and this obra's. The Obra tab warns with it.
 */
export async function listProjectAttention(ctx: Ctx, projectId: string): Promise<AttentionItem[]> {
  // Only the companies working on this obra are loaded.
  const rows = await db
    .select({ id: subcontractorAssignments.subcontractorId })
    .from(subcontractorAssignments)
    .where(and(eq(subcontractorAssignments.projectId, projectId), eq(subcontractorAssignments.tenantId, ctx.tenantId)));
  if (rows.length === 0) return [];
  const assigned = new Set(rows.map((r) => r.id));
  const net = await loadNetwork(ctx.tenantId, [...assigned]);
  return attentionItems(net).filter(
    (item) => assigned.has(item.subcontractorId) && (item.projectId === null || item.projectId === projectId),
  );
}

function expiryCounts(net: Network) {
  let expiring = 0;
  let expired = 0;
  for (const doc of net.docs) {
    const { state } = docState(doc.requirementId, net.facts(doc), net.today);
    if (state === "expiring") expiring++;
    if (state === "expired") expired++;
  }
  return { expiring, expired };
}

/** The rail's badges: companies, workers, and documents expired or expiring. */
/**
 * The rail's badges: companies, workers, and documents expired or expiring.
 * Shown on every dashboard page, so it counts in SQL and reads only the
 * documents whose current version expires within the longest alert window.
 */
export async function getCounts(ctx: Ctx): Promise<SubcontractorCounts> {
  const today = todayInSpain();
  const latest = db
    .selectDistinctOn([subcontractorDocumentVersions.documentId], {
      documentId: subcontractorDocumentVersions.documentId,
      expiresAt: subcontractorDocumentVersions.expiresAt,
    })
    .from(subcontractorDocumentVersions)
    .where(eq(subcontractorDocumentVersions.tenantId, ctx.tenantId))
    .orderBy(subcontractorDocumentVersions.documentId, desc(subcontractorDocumentVersions.version))
    .as("latest");
  const [companies, workers, dated] = await Promise.all([
    db.$count(subcontractors, eq(subcontractors.tenantId, ctx.tenantId)),
    db.$count(subcontractorWorkers, eq(subcontractorWorkers.tenantId, ctx.tenantId)),
    db
      .select({
        requirementId: subcontractorDocuments.requirementId,
        status: subcontractorDocuments.status,
        expiresAt: latest.expiresAt,
      })
      .from(subcontractorDocuments)
      .innerJoin(latest, eq(latest.documentId, subcontractorDocuments.id))
      .where(
        and(
          eq(subcontractorDocuments.tenantId, ctx.tenantId),
          inArray(subcontractorDocuments.status, ["uploaded", "validated"]),
          lte(latest.expiresAt, addDays(today, 30)),
        ),
      ),
  ]);
  const expiries = dated.filter((d) => {
    const { state } = docState(d.requirementId, d, today);
    return state === "expiring" || state === "expired";
  }).length;
  return { companies, workers, expiries };
}

export async function getSubcontractor(ctx: Ctx, subcontractorId: string): Promise<SubcontractorDetail> {
  // Scoped to the tenant: nothing loads for another tenant's company.
  const net = await loadNetwork(ctx.tenantId, subcontractorId);
  const row = net.companies[0];
  if (!row) fail("not_found");
  const audit = auditRows(ctx, row.id);
  const versions = await allVersions(
    ctx.tenantId,
    net.docs.filter((d) => !d.workerId).map((d) => d.id),
  );
  const names = await userNames(ctx.tenantId, [...versions.values()].flat());
  const docOf = (projectId: string | null, req: DocumentRequirement) => {
    const doc = net.doc(row.id, null, projectId, req.id);
    return toDoc(req, { workerId: null, projectId }, doc, (doc && versions.get(doc.id)) ?? [], names, net.today);
  };

  const documents = requirementsFor("company").map((req) => docOf(null, req));
  const pss = requirement("adhesion_pss")!;
  const assignments: SubcontractorAssignment[] = net.assignmentsOf(row.id).map((a) => {
    const project = net.projectsById.get(a.projectId)!;
    const access = { ok: 0, pending: 0, blocked: 0 };
    for (const w of net.workersOf(row.id)) access[net.access(w, a).status]++;
    return {
      projectId: a.projectId,
      projectRef: project.ref,
      projectAddress: project.address,
      chapterCodes: a.chapterCodes,
      plannedStart: a.plannedStart,
      plannedEnd: a.plannedEnd,
      bookOrder: a.bookOrder,
      bookDate: a.bookDate,
      cssInformed: a.cssInformed,
      pssAdhesion: docOf(a.projectId, pss),
      workers: access,
    };
  });

  const status = net.status(row.id);
  const manage = canEdit(ctx.role);
  return {
    ...fieldsOf(row),
    id: row.id,
    taxId: manage ? row.taxId : maskIdNumber(row.taxId),
    reaRegion: row.reaRegion as Region,
    status,
    lowPermanentShare: lowPermanentShare(row.headcount, row.permanentCount),
    documents,
    assignments,
    workers: net.workersOf(row.id).map((w) => workerListItem(net, w, row)),
    history: history(await audit, row.id, net, documents),
    canManage: manage,
  };
}

/**
 * The audit log, newest first, with the expiries the system applies on its
 * own (a mandatory document expiring blocks the company) slotted in.
 */
function auditRows(ctx: Ctx, subcontractorId: string) {
  return db
    .select({
      id: subcontractorAudit.id,
      at: subcontractorAudit.createdAt,
      action: subcontractorAudit.action,
      detail: subcontractorAudit.detail,
      workerId: subcontractorAudit.workerId,
      userName: users.name,
      userEmail: users.email,
    })
    .from(subcontractorAudit)
    .leftJoin(users, eq(users.id, subcontractorAudit.userId))
    .where(and(eq(subcontractorAudit.subcontractorId, subcontractorId), eq(subcontractorAudit.tenantId, ctx.tenantId)))
    .orderBy(desc(subcontractorAudit.createdAt))
    .limit(500);
}

function history(
  rows: Awaited<ReturnType<typeof auditRows>>,
  subcontractorId: string,
  net: Network,
  documents: SubcontractorDetail["documents"],
): SubcontractorAuditEntry[] {
  const workerNames = new Map(net.workers.map((w) => [w.id, workerName(w)]));
  const entries: SubcontractorAuditEntry[] = rows.map((r) => ({
    id: r.id,
    at: r.at.toISOString(),
    action: r.action,
    userName: r.userName ?? r.userEmail,
    workerName: r.workerId ? (workerNames.get(r.workerId) ?? null) : null,
    detail: r.detail,
  }));
  for (const doc of documents) {
    const mandatory = requirement(doc.requirementId)?.mandatory;
    if (doc.state !== "expired" || !mandatory || !doc.expiresAt) continue;
    entries.push({
      id: `expired-${doc.id}`,
      at: `${addDays(doc.expiresAt, 1)}T00:00:00.000Z`,
      action: "document_expired",
      userName: null,
      workerName: null,
      detail: { requirementId: doc.requirementId, affectedWorkers: net.workersOf(subcontractorId).length },
    });
  }
  return entries.sort((a, b) => b.at.localeCompare(a.at));
}

// ─── Documents ───────────────────────────────────────────────────────────────

/** Who a document belongs to: the company, one of its workers, or the company on one obra. */
async function owner(ctx: Ctx, subcontractorId: string, input: Record<string, unknown>) {
  const req = requirement(str(input.requirementId));
  if (!req) fail("invalid_requirement");
  const workerId = req.scope === "worker" ? str(input.workerId) : "";
  const projectId = req.scope === "obra" ? str(input.projectId) : "";
  if ((req.scope === "worker" && !workerId) || (req.scope === "obra" && !projectId)) fail("missing_fields");
  if (workerId) await requireWorker(ctx, workerId, subcontractorId);
  if (projectId) await requireProjectRef(ctx, projectId);
  return { req, workerId: workerId || null, projectId: projectId || null };
}

async function requireProjectRef(ctx: Ctx, projectId: string) {
  const [project] = await db
    .select({ id: projects.id, ref: projects.ref })
    .from(projects)
    .where(projectInTenant(ctx.tenantId, projectId));
  if (!project) fail("project_not_found");
  return project;
}

type Owner = { workerId: string | null; projectId: string | null; req: { id: string } };

function ownerWhere(ctx: Ctx, subcontractorId: string, own: Owner) {
  return and(
    eq(subcontractorDocuments.tenantId, ctx.tenantId),
    eq(subcontractorDocuments.subcontractorId, subcontractorId),
    eq(subcontractorDocuments.requirementId, own.req.id),
    own.workerId ? eq(subcontractorDocuments.workerId, own.workerId) : isNull(subcontractorDocuments.workerId),
    own.projectId ? eq(subcontractorDocuments.projectId, own.projectId) : isNull(subcontractorDocuments.projectId),
  );
}

function findDoc(ctx: Ctx, subcontractorId: string, own: Owner) {
  return db.query.subcontractorDocuments.findFirst({ where: ownerWhere(ctx, subcontractorId, own) });
}

/**
 * Uploads a new version of a document. Multipart body: { requirementId,
 * workerId? (worker documents), projectId? (obra documents), issuedAt?,
 * expiresAt?, file } — a PDF of at most 4 MB. Without `expiresAt` the
 * expiry follows from the issue date and the requirement's validity.
 */
export async function uploadDocument(ctx: Ctx, subcontractorId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const [, own] = await Promise.all([requireCompany(ctx, subcontractorId), owner(ctx, subcontractorId, input)]);
  const file = await requirePdf(input.file);

  const issuedAt = calendarDate(input.issuedAt);
  const expiresAt = calendarDate(input.expiresAt) ?? (issuedAt ? defaultExpiry(own.req.id, issuedAt) : null);
  if (own.req.validityMonths && !expiresAt) fail("missing_dates");

  const filename = (file instanceof File && file.name ? file.name : `${own.req.id}.pdf`).slice(0, 200);
  const versionId = crypto.randomUUID();
  const pathname = `tenants/${ctx.tenantId}/subcontractors/${subcontractorId}/${versionId}.pdf`;

  let version = 0;
  await storeFiles([{ pathname, body: file, contentType: "application/pdf" }], () =>
    db.transaction(async (tx) => {
      // Create the document if needed, then lock it: concurrent uploads of the
      // same document take their version numbers one after the other.
      await tx
        .insert(subcontractorDocuments)
        .values({
          tenantId: ctx.tenantId,
          subcontractorId,
          workerId: own.workerId,
          projectId: own.projectId,
          requirementId: own.req.id,
          status: "uploaded",
        })
        .onConflictDoNothing();
      const [locked] = await tx
        .select({ id: subcontractorDocuments.id })
        .from(subcontractorDocuments)
        .where(ownerWhere(ctx, subcontractorId, own))
        .for("update");
      const documentId = locked!.id;
      await tx
        .update(subcontractorDocuments)
        .set({ status: "uploaded", notApplicableReason: null })
        .where(eq(subcontractorDocuments.id, documentId));
      const [last] = await tx
        .select({ version: subcontractorDocumentVersions.version })
        .from(subcontractorDocumentVersions)
        .where(eq(subcontractorDocumentVersions.documentId, documentId))
        .orderBy(desc(subcontractorDocumentVersions.version))
        .limit(1);
      version = (last?.version ?? 0) + 1;
      await tx.insert(subcontractorDocumentVersions).values({
        id: versionId,
        tenantId: ctx.tenantId,
        documentId,
        version,
        pathname,
        filename,
        sizeBytes: file.size,
        issuedAt,
        expiresAt,
        uploadedById: ctx.userId,
      });
      await audit(
        tx,
        ctx,
        subcontractorId,
        "document_uploaded",
        { requirementId: own.req.id, version, projectId: own.projectId },
        own.workerId,
      );
    }),
  );
  return { versionId, version };
}

/** The document and its current version, if the version still waits for review. */
async function reviewable(ctx: Ctx, subcontractorId: string, documentId: string) {
  const doc = await db.query.subcontractorDocuments.findFirst({
    where: and(
      eq(subcontractorDocuments.id, documentId),
      eq(subcontractorDocuments.subcontractorId, subcontractorId),
      eq(subcontractorDocuments.tenantId, ctx.tenantId),
    ),
  });
  if (!doc) fail("not_found");
  const [version] = await db
    .select()
    .from(subcontractorDocumentVersions)
    .where(eq(subcontractorDocumentVersions.documentId, doc.id))
    .orderBy(desc(subcontractorDocumentVersions.version))
    .limit(1);
  if (doc.status !== "uploaded" || !version || version.reviewedAt) fail("nothing_to_review");
  return { doc, version };
}

/** Records the review of the document's current version: validated, or rejected with a reason. */
async function review(ctx: Ctx, subcontractorId: string, documentId: string, reason: string | null) {
  requireEditor(ctx);
  const { doc, version } = await reviewable(ctx, subcontractorId, documentId);
  await db.transaction(async (tx) => {
    await tx
      .update(subcontractorDocumentVersions)
      .set({ reviewedById: ctx.userId, reviewedAt: new Date(), rejectReason: reason })
      .where(eq(subcontractorDocumentVersions.id, version.id));
    await tx
      .update(subcontractorDocuments)
      .set({ status: reason ? "rejected" : "validated" })
      .where(eq(subcontractorDocuments.id, doc.id));
    await audit(
      tx,
      ctx,
      subcontractorId,
      reason ? "document_rejected" : "document_validated",
      { requirementId: doc.requirementId, version: version.version, projectId: doc.projectId, ...(reason ? { reason } : {}) },
      doc.workerId,
    );
  });
  return { documentId };
}

export function validateDocument(ctx: Ctx, subcontractorId: string, documentId: string) {
  return review(ctx, subcontractorId, documentId, null);
}

/** Body: { reason } — told to the company so it can upload a correct version. */
export async function rejectDocument(
  ctx: Ctx,
  subcontractorId: string,
  documentId: string,
  input: Record<string, unknown>,
) {
  requireEditor(ctx);
  const reason = str(input.reason);
  if (!reason) fail("missing_reason");
  return review(ctx, subcontractorId, documentId, reason);
}

/** An optional company document that doesn't apply. Body: { requirementId, reason }. */
export async function markNotApplicable(ctx: Ctx, subcontractorId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  await requireCompany(ctx, subcontractorId);
  const entry = notApplicableEntry(input);
  const existing = await findDoc(ctx, subcontractorId, { req: entry, workerId: null, projectId: null });
  await db.transaction((tx) => saveNotApplicable(tx, ctx, subcontractorId, entry, existing?.id));
  return { subcontractorId };
}

/** { requirementId, reason } of an optional company document. */
function notApplicableEntry(input: Record<string, unknown>) {
  const req = requirement(str(input.requirementId));
  if (!req) fail("invalid_requirement");
  if (req.mandatory || req.scope !== "company") fail("not_optional");
  const reason = str(input.reason);
  if (!reason) fail("missing_reason");
  return { id: req.id, reason };
}

async function saveNotApplicable(
  tx: Transaction,
  ctx: Ctx,
  subcontractorId: string,
  entry: { id: string; reason: string },
  existingId: string | undefined,
) {
  if (existingId) {
    await tx
      .update(subcontractorDocuments)
      .set({ status: "not_applicable", notApplicableReason: entry.reason })
      .where(eq(subcontractorDocuments.id, existingId));
  } else {
    await tx.insert(subcontractorDocuments).values({
      tenantId: ctx.tenantId,
      subcontractorId,
      requirementId: entry.id,
      status: "not_applicable",
      notApplicableReason: entry.reason,
    });
  }
  await audit(tx, ctx, subcontractorId, "document_not_applicable", { requirementId: entry.id, reason: entry.reason });
}

/**
 * Asks the company for documents ("Solicitar"), or reminds it of ones already
 * asked for ("Recordar"). Body: { requirementIds, workerId?, projectId? }.
 * A document that is valid, expired or awaiting validation keeps its status.
 */
export async function requestDocuments(ctx: Ctx, subcontractorId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  await requireCompany(ctx, subcontractorId);
  const ids = Array.isArray(input.requirementIds) ? input.requirementIds : [input.requirementId];
  if (ids.length === 0) fail("missing_fields");
  const owners = await Promise.all(
    ids.map((id) => owner(ctx, subcontractorId, { ...input, requirementId: id })),
  );

  await db.transaction(async (tx) => {
    for (const own of owners) {
      const existing = await findDoc(ctx, subcontractorId, own);
      // Asked for before and still not in: a reminder.
      const reminder = !!existing?.requestedAt && existing.status !== "uploaded" && existing.status !== "validated";
      if (existing) {
        await tx
          .update(subcontractorDocuments)
          .set({
            requestedAt: new Date(),
            ...(existing.status === "rejected" || existing.status === "not_applicable" ? { status: "requested" as const } : {}),
          })
          .where(eq(subcontractorDocuments.id, existing.id));
      } else {
        await tx.insert(subcontractorDocuments).values({
          tenantId: ctx.tenantId,
          subcontractorId,
          workerId: own.workerId,
          projectId: own.projectId,
          requirementId: own.req.id,
          status: "requested",
          requestedAt: new Date(),
        });
      }
      await audit(
        tx,
        ctx,
        subcontractorId,
        reminder ? "document_reminded" : "document_requested",
        { requirementId: own.req.id, projectId: own.projectId },
        own.workerId,
      );
    }
  });
  return { subcontractorId };
}

/** One version's PDF, for the tenant's staff. */
export async function openDocumentVersion(ctx: Ctx, subcontractorId: string, versionId: string): Promise<StoredFile> {
  const [row] = await db
    .select({
      pathname: subcontractorDocumentVersions.pathname,
      filename: subcontractorDocumentVersions.filename,
      sizeBytes: subcontractorDocumentVersions.sizeBytes,
    })
    .from(subcontractorDocumentVersions)
    .innerJoin(subcontractorDocuments, eq(subcontractorDocuments.id, subcontractorDocumentVersions.documentId))
    .where(
      and(
        eq(subcontractorDocumentVersions.id, versionId),
        eq(subcontractorDocuments.subcontractorId, subcontractorId),
        eq(subcontractorDocumentVersions.tenantId, ctx.tenantId),
      ),
    );
  if (!row) fail("not_found");
  return openStoredFile({ ...row, contentType: "application/pdf" });
}

// ─── Obra assignments ────────────────────────────────────────────────────────

/**
 * Puts a company on an obra, or changes what it does there. Body: {
 * chapterCodes, plannedStart?, plannedEnd?, bookOrder?, bookDate?, cssInformed? }.
 */
export async function assignToProject(
  ctx: Ctx,
  subcontractorId: string,
  projectId: string,
  input: Record<string, unknown>,
) {
  requireEditor(ctx);
  const [, project] = await Promise.all([requireCompany(ctx, subcontractorId), requireProjectRef(ctx, projectId)]);
  const values = assignmentValues(input);
  await db.transaction((tx) => saveAssignment(tx, ctx, subcontractorId, project, values));
  return { subcontractorId, projectId };
}

function assignmentValues(input: Record<string, unknown>) {
  const codes = Array.isArray(input.chapterCodes)
    ? input.chapterCodes.map(str)
    : str(input.chapterCodes).split(",").filter(Boolean);
  if (codes.some((code) => !BUDGET_CHAPTER_CODES.includes(code))) fail("invalid_chapter");
  const values = {
    chapterCodes: [...new Set(codes)].sort(),
    plannedStart: calendarDate(input.plannedStart),
    plannedEnd: calendarDate(input.plannedEnd),
    bookOrder: count(input.bookOrder),
    bookDate: calendarDate(input.bookDate),
    cssInformed: bool(input.cssInformed),
  };
  if (values.plannedStart && values.plannedEnd && values.plannedEnd < values.plannedStart) fail("invalid_date");
  return values;
}

async function saveAssignment(
  tx: Transaction,
  ctx: Ctx,
  subcontractorId: string,
  project: { id: string; ref: string },
  values: ReturnType<typeof assignmentValues>,
) {
  await tx
    .insert(subcontractorAssignments)
    .values({ tenantId: ctx.tenantId, subcontractorId, projectId: project.id, ...values })
    .onConflictDoUpdate({
      target: [subcontractorAssignments.subcontractorId, subcontractorAssignments.projectId],
      set: values,
    });
  await audit(tx, ctx, subcontractorId, "assigned", { projectId: project.id, projectRef: project.ref, ...values });
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function removeAssignment(ctx: Ctx, subcontractorId: string, projectId: string) {
  requireEditor(ctx);
  await requireCompany(ctx, subcontractorId);
  const removed = await db
    .delete(subcontractorAssignments)
    .where(
      and(
        eq(subcontractorAssignments.subcontractorId, subcontractorId),
        eq(subcontractorAssignments.projectId, projectId),
        eq(subcontractorAssignments.tenantId, ctx.tenantId),
      ),
    )
    .returning({ id: subcontractorAssignments.id });
  if (removed.length === 0) fail("not_found");
  await audit(db, ctx, subcontractorId, "unassigned", { projectId });
}

export async function listProjectOptions(ctx: Ctx) {
  const rows = await db
    .select({ id: projects.id, ref: projects.ref, address: projects.address, obraStage: projects.obraStage })
    .from(projects)
    .where(eq(projects.tenantId, ctx.tenantId))
    .orderBy(asc(projects.ref));
  return projectOptions(ctx.tenantId, rows);
}

// ─── CAE dossier ─────────────────────────────────────────────────────────────

const zipName = (raw: string) => raw.replace(/[\\/:*?"<>|]+/g, "-").trim();

/**
 * A ZIP of the current, valid version of every document: of all companies, or
 * of those on one obra (`projectId`) with that obra's own documents. With an
 * index (indice.csv) of what is in it and what is missing. Streamed, one file
 * at a time as the client reads: it can be larger than a function response may
 * otherwise be. Admins and managers only: it holds CIFs and DNIs in full.
 */
export async function exportDossier(
  ctx: Ctx,
  options: { projectId?: string | null; subcontractorId?: string | null } = {},
): Promise<Omit<StoredFile, "sizeBytes">> {
  requireEditor(ctx);
  const net = await loadNetwork(ctx.tenantId);
  const projectId = options.projectId || null;
  if (projectId && !net.projectsById.has(projectId)) fail("project_not_found");
  const companies = net.companies.filter(
    (c) =>
      (!options.subcontractorId || c.id === options.subcontractorId) &&
      (!projectId || net.assignmentsOf(c.id).some((a) => a.projectId === projectId)),
  );
  if (options.subcontractorId && companies.length === 0) fail("not_found");

  const files: { path: string; pathname: string }[] = [];
  const index: string[][] = [["empresa", "cif", "estado", "trabajador", "documento", "estado_documento", "version", "caduca"]];
  for (const c of companies) {
    const folder = zipName(`${c.legalName} (${c.taxId})`);
    const status = net.status(c.id).status;
    for (const doc of net.docs.filter((d) => d.subcontractorId === c.id && (!d.projectId || d.projectId === projectId))) {
      const version = net.validVersion(doc) ?? net.versions.get(doc.id);
      const { state } = docState(doc.requirementId, net.facts(doc), net.today);
      const worker = doc.workerId ? net.workersById.get(doc.workerId) : undefined;
      const workerName = worker ? `${worker.surnames}, ${worker.firstName}` : "";
      index.push([c.legalName, c.taxId, status, workerName, doc.requirementId, state, String(version?.version ?? ""), version?.expiresAt ?? ""]);
      if (!version || !net.validVersion(doc)) continue;
      // The DNI keeps namesakes apart.
      const sub = worker
        ? `trabajadores/${zipName(`${workerName} (${worker.idDocument})`)}`
        : doc.projectId
          ? `obra ${zipName(net.projectsById.get(doc.projectId)!.ref)}`
          : "empresa";
      files.push({ path: `${folder}/${sub}/${doc.requirementId}_v${version.version}.pdf`, pathname: version.pathname });
    }
  }
  const csv = index.map((row) => row.map((cell) => `"${cell.replaceAll('"', '""')}"`).join(";")).join("\r\n");

  const entries = [
    { path: "indice.csv", open: async () => new Blob([`\uFEFF${csv}`]).stream() },
    ...files.map((f) => ({ path: f.path, open: () => readFile(f.pathname) })),
  ];
  const chunks: Uint8Array[] = [];
  let finished = false;
  let failure: unknown = null;
  const zip = new Zip((error, chunk, final) => {
    if (error) failure = error;
    chunks.push(chunk);
    if (final) finished = true;
  });
  let next = 0;
  const body = new ReadableStream<Uint8Array>({
    // Adds the next file only once the client has taken what is ready.
    async pull(controller) {
      while (chunks.length === 0 && !finished && !failure) {
        const entry = entries[next++];
        if (!entry) {
          zip.end();
          continue;
        }
        const stream = await entry.open();
        if (!stream) continue;
        const file = new ZipPassThrough(entry.path);
        zip.add(file);
        const reader = stream.getReader();
        for (let read = await reader.read(); !read.done; read = await reader.read()) file.push(read.value);
        file.push(new Uint8Array(0), true);
      }
      if (failure) controller.error(failure);
      else if (chunks.length > 0) controller.enqueue(chunks.shift()!);
      else controller.close();
    },
  });
  const ref = projectId ? `-${net.projectsById.get(projectId)!.ref}` : "";
  return { filename: `dossier-cae${ref}-${net.today}.zip`, contentType: "application/zip", body };
}
