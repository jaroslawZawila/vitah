import { and, db, eq, or, subcontractorDocuments, subcontractors, subcontractorWorkers } from "@repo/db";
import { isUniqueViolation } from "./accounts";
import { canEdit, requireEditor, type Ctx } from "./context";
import {
  CONTRACT_TYPES,
  PPE_ITEMS,
  SUBCONTRACTOR_TRADES,
  WORKER_CATEGORIES,
  WORKER_ROLES,
  docState,
  isValidPersonalId,
  maskIdNumber,
  normalizeIdNumber,
  requirementsFor,
  workerName,
  type AccessCheckResult,
  type DocBadge,
  type RequirementId,
  type WorkerDetail,
  type WorkerFields,
  type WorkerListItem,
} from "./contract";
import {
  allVersions,
  audit,
  calendarDate,
  changes,
  fail,
  hasBookEntry,
  listOf,
  loadNetwork,
  merged,
  oneOf,
  optional,
  phone,
  requireCaeCompany,
  requireWorker,
  str,
  toDoc,
  userNames,
  type AssignmentRow,
  type CompanyRow,
  type Network,
  type WorkerRow,
} from "./subcontractor-network";

// ─── Subcontractor workers ────────────────────────────────────────────────────
// The people each company sends to site. Their access to an obra is computed
// (./subcontractor-rules.ts workerAccess) from their company's status, their
// own documents, their roles and the chapters their company does there. Their
// documents are uploaded and reviewed through ./subcontractors.ts like the
// company's. Every staff member reads; admins and managers write.
// ─────────────────────────────────────────────────────────────────────────────

const SS_PATTERN = /^[0-9][0-9 /-]{9,15}$/;

async function parseFields(ctx: Ctx, input: Record<string, unknown>, base?: WorkerFields): Promise<WorkerFields> {
  const get = merged(input, base);
  const subcontractorId = str(get("subcontractorId"));
  const firstName = str(get("firstName"));
  const surnames = str(get("surnames"));
  const idDocument = normalizeIdNumber(str(get("idDocument")));
  if (!subcontractorId || !firstName || !surnames || !idDocument) fail("missing_fields");
  if (!isValidPersonalId(idDocument)) fail("invalid_id_document");

  await requireCaeCompany(ctx, subcontractorId);
  const ssNumber = optional(get("ssNumber"));
  if (ssNumber !== null && !SS_PATTERN.test(ssNumber)) fail("invalid_number");

  return {
    subcontractorId,
    firstName,
    surnames,
    idDocument,
    phone: phone(get("phone")),
    category: oneOf(get("category"), WORKER_CATEGORIES),
    trade: oneOf(get("trade"), SUBCONTRACTOR_TRADES),
    ssNumber,
    contractType: oneOf(get("contractType"), CONTRACT_TYPES),
    startDate: calendarDate(get("startDate")),
    tpcNumber: normalizeIdNumber(str(get("tpcNumber"))) || null,
    roles: listOf(get("roles"), WORKER_ROLES),
    ppeItems: listOf(get("ppeItems"), PPE_ITEMS),
  };
}

function fieldsOf(row: WorkerRow): WorkerFields {
  const { id: _, tenantId: __, createdAt: ___, updatedAt: ____, ...fields } = row;
  return fields;
}

const WORKER_REQUIREMENTS = requirementsFor("worker");

/** A worker as the lists show them: anywhere, or on one obra (`assignment`). */
export function workerListItem(
  net: Network,
  worker: WorkerRow,
  company: CompanyRow,
  assignment: AssignmentRow | null = null,
): WorkerListItem {
  const docs: Partial<Record<RequirementId, DocBadge>> = {};
  for (const req of WORKER_REQUIREMENTS) {
    docs[req.id] = docState(req.id, net.facts(net.doc(company.id, worker.id, null, req.id)), net.today);
  }
  return {
    id: worker.id,
    subcontractorId: company.id,
    subcontractorName: company.legalName,
    subcontractorKind: company.kind,
    firstName: worker.firstName,
    surnames: worker.surnames,
    idDocumentMasked: maskIdNumber(worker.idDocument),
    trade: worker.trade,
    category: worker.category,
    roles: worker.roles,
    docs,
    access: net.access(worker, assignment),
  };
}

/** Every worker, or those whose company is on one obra (with their access there). */
export async function listWorkers(ctx: Ctx, options: { projectId?: string | null } = {}): Promise<WorkerListItem[]> {
  const net = await loadNetwork(ctx.tenantId);
  const companies = new Map(net.companies.map((c) => [c.id, c]));
  const projectId = options.projectId || null;
  return net.workers.flatMap((w) => {
    const assignment = projectId
      ? net.assignmentsOf(w.subcontractorId).find((a) => a.projectId === projectId)
      : null;
    if (projectId && !assignment) return [];
    return [workerListItem(net, w, companies.get(w.subcontractorId)!, assignment ?? null)];
  });
}

export async function getWorker(ctx: Ctx, workerId: string): Promise<WorkerDetail> {
  const row = await requireWorker(ctx, workerId);
  const net = await loadNetwork(ctx.tenantId, row.subcontractorId);
  const company = net.companies[0]!;
  const own = net.docs.filter((d) => d.workerId === row.id);
  const versions = await allVersions(ctx.tenantId, own.map((d) => d.id));
  const names = await userNames(ctx.tenantId, [...versions.values()].flat());
  const manage = canEdit(ctx.role);

  return {
    ...fieldsOf(row),
    id: row.id,
    idDocument: manage ? row.idDocument : maskIdNumber(row.idDocument),
    subcontractorName: company.legalName,
    subcontractorKind: company.kind,
    companyStatus: net.status(company.id).status,
    documents: WORKER_REQUIREMENTS.map((req) => {
      const doc = net.doc(company.id, row.id, null, req.id);
      return toDoc(req, { workerId: row.id, projectId: null }, doc, (doc && versions.get(doc.id)) ?? [], names, net.today);
    }),
    access: net.access(row),
    obras: net.assignmentsOf(company.id).map((a) => ({
      projectId: a.projectId,
      projectRef: net.projectsById.get(a.projectId)!.ref,
      chapterCodes: a.chapterCodes,
      pssAdhesion: net.facts(net.doc(company.id, null, a.projectId, "adhesion_pss")) ?? null,
      bookEntry: hasBookEntry(a),
      access: net.access(row, a),
    })),
    canManage: manage,
  };
}

/** Body: WorkerFields. */
export async function createWorker(ctx: Ctx, input: Record<string, unknown>) {
  requireEditor(ctx);
  const fields = await parseFields(ctx, input);
  try {
    const id = await db.transaction(async (tx) => {
      const [row] = await tx
        .insert(subcontractorWorkers)
        .values({ ...fields, tenantId: ctx.tenantId })
        .returning({ id: subcontractorWorkers.id });
      await audit(tx, ctx, fields.subcontractorId, "worker_created", { name: workerName(fields) }, row!.id);
      return row!.id;
    });
    return { id };
  } catch (error) {
    if (isUniqueViolation(error)) fail("id_document_exists");
    throw error;
  }
}

/** Body: any of WorkerFields. Moving a worker to another company takes their documents along. */
export async function updateWorker(ctx: Ctx, workerId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const row = await requireWorker(ctx, workerId);
  const before = fieldsOf(row);
  const after = await parseFields(ctx, input, before);
  const diff = changes(before, after);
  if (Object.keys(diff).length === 0) return { id: workerId };
  try {
    await db.transaction(async (tx) => {
      await tx.update(subcontractorWorkers).set(after).where(eq(subcontractorWorkers.id, workerId));
      if (after.subcontractorId !== before.subcontractorId) {
        await tx
          .update(subcontractorDocuments)
          .set({ subcontractorId: after.subcontractorId })
          .where(eq(subcontractorDocuments.workerId, workerId));
      }
      await audit(tx, ctx, after.subcontractorId, "worker_updated", { fields: diff }, workerId);
    });
  } catch (error) {
    if (isUniqueViolation(error)) fail("id_document_exists");
    throw error;
  }
  return { id: workerId };
}

/**
 * "Comprobar acceso" at the site entrance: the worker with this DNI/NIE or TPC
 * number and their access, anywhere or on one obra. Body: { query, projectId? }.
 */
export async function checkAccess(ctx: Ctx, input: Record<string, unknown>): Promise<AccessCheckResult> {
  const query = normalizeIdNumber(str(input.query));
  if (!query) fail("missing_fields");
  const [row] = await db
    .select()
    .from(subcontractorWorkers)
    .where(
      and(
        eq(subcontractorWorkers.tenantId, ctx.tenantId),
        or(eq(subcontractorWorkers.idDocument, query), eq(subcontractorWorkers.tpcNumber, query)),
      ),
    )
    .limit(1);
  if (!row) return { worker: null, access: null };

  const net = await loadNetwork(ctx.tenantId, row.subcontractorId);
  const projectId = optional(input.projectId);
  // On an obra the company isn't assigned to, the obra's own checks fail (no PSS adhesion, no book entry).
  const assignment = projectId
    ? (net.assignmentsOf(row.subcontractorId).find((a) => a.projectId === projectId) ?? {
        subcontractorId: row.subcontractorId,
        projectId,
        chapterCodes: [],
        bookOrder: null,
        bookDate: null,
      })
    : null;
  return {
    worker: { id: row.id, name: workerName(row), subcontractorName: net.companies[0]!.legalName },
    access: net.access(row, assignment),
  };
}
