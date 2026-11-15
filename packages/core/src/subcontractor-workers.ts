import { and, db, eq, or, subcontractorDocuments, subcontractors, subcontractorWorkers } from "@repo/db";
import { isUniqueViolation } from "./accounts";
import { canEdit, requireEditor, type Ctx } from "./context";
import {
  docState,
  isValidPersonalId,
  maskIdNumber,
  requirementsFor,
  workerName,
  type AccessCheckResult,
  type DocBadge,
  type RequirementId,
  type WorkerDetail,
  type WorkerFields,
  type WorkerListItem,
  type WorkerListQuery,
  type WorkersPage,
} from "./contract";
import { parse } from "./inputs/fields";
import { accessCheckSchema, workerIdentitySchema, workerListSchema, workerSchema } from "./inputs/subcontractors";
import { pageWindow, pagingOf } from "./paging";
import {
  allVersions,
  audit,
  changes,
  fail,
  hasBookEntry,
  loadNetwork,
  requireCaeCompany,
  requireProjectRef,
  requireWorker,
  toDoc,
  userNames,
  type AssignmentRow,
  type CompanyRow,
  type Network,
  type WorkerRow,
} from "./subcontractor-network";
import { caeTransaction, refreshCae } from "./subcontractor-attention";

// ─── Subcontractor workers ────────────────────────────────────────────────────
// The people each company sends to site. Their access to an obra is computed
// (./subcontractor-rules.ts workerAccess) from their company's status, their
// own documents, their roles and the chapters their company does there. Their
// documents are uploaded and reviewed through ./subcontractors.ts like the
// company's. Every staff member reads; admins and managers write.
// ─────────────────────────────────────────────────────────────────────────────

/** The worker's fields from `input`; an update passes the current ones as `base`, under what it sends. */
async function parseFields(ctx: Ctx, input: Record<string, unknown>, base?: WorkerFields): Promise<WorkerFields> {
  const merged = base ? { ...base, ...input } : input;
  const { subcontractorId, firstName, surnames, idDocument } = parse(workerIdentitySchema, merged);
  if (!subcontractorId || !firstName || !surnames || !idDocument) fail("missing_fields");
  if (!isValidPersonalId(idDocument)) fail("invalid_id_document");

  await requireCaeCompany(ctx, subcontractorId);
  const { ssNumber, phone, category, trade, contractType, startDate, tpcNumber, roles, ppeItems } = parse(workerSchema, merged);
  return { subcontractorId, firstName, surnames, idDocument, phone, category, trade, ssNumber, contractType, startDate, tpcNumber, roles, ppeItems };
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

/**
 * One page of the workers, by surname, with the counts and KPIs of the whole
 * list. A worker's access is worked out from the documents (never stored), so
 * the list is still built in memory from the tenant's network and then cut:
 * what paging saves is the response, not the load.
 */
export async function listWorkersPage(ctx: Ctx, query: WorkerListQuery = {}): Promise<WorkersPage> {
  const window = pageWindow(query);
  const { access, companyId, projectId, ...filters } = parse(workerListSchema, query);
  const q = filters.q.toLowerCase();
  const all = await listWorkers(ctx, { projectId: projectId || null });
  const matching = all.filter(
    (w) => (!companyId || w.subcontractorId === companyId) && (!q || `${workerName(w)} ${w.subcontractorName}`.toLowerCase().includes(q)),
  );
  const having = (list: WorkerListItem[], status: string) => list.filter((w) => w.access.status === status).length;
  const shown = access === "all" ? matching : matching.filter((w) => w.access.status === access);
  return {
    workers: shown.slice(window.offset, window.offset + window.limit),
    paging: pagingOf(window, shown.length),
    counts: { all: matching.length, ok: having(matching, "ok"), pending: having(matching, "pending"), blocked: having(matching, "blocked") },
    summary: {
      registered: all.length,
      companies: new Set(all.map((w) => w.subcontractorId)).size,
      ok: having(all, "ok"),
      pending: having(all, "pending"),
      blocked: having(all, "blocked"),
      preventive: all.filter((w) => w.roles.includes("preventive_resource")).length,
    },
  };
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
    const id = await caeTransaction(ctx.tenantId, [fields.subcontractorId], async (tx) => {
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
    // Their documents go with them: both companies' warnings change.
    await caeTransaction(ctx.tenantId, [before.subcontractorId, after.subcontractorId], async (tx) => {
      // Where the worker is now: another move, committed while this one waited for the locks, may have taken
      // them (and their documents) to a third company, whose values then change too.
      const [now] = await tx
        .select({ subcontractorId: subcontractorWorkers.subcontractorId })
        .from(subcontractorWorkers)
        .where(eq(subcontractorWorkers.id, workerId))
        .for("update");
      await tx.update(subcontractorWorkers).set(after).where(eq(subcontractorWorkers.id, workerId));
      if (after.subcontractorId !== (now?.subcontractorId ?? before.subcontractorId)) {
        await tx
          .update(subcontractorDocuments)
          .set({ subcontractorId: after.subcontractorId })
          .where(eq(subcontractorDocuments.workerId, workerId));
      }
      await audit(tx, ctx, after.subcontractorId, "worker_updated", { fields: diff }, workerId);
      if (now && now.subcontractorId !== before.subcontractorId) await refreshCae(tx, ctx.tenantId, [now.subcontractorId]);
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
 * An obra that isn't the tenant's, or was deleted, is `project_not_found`.
 */
export async function checkAccess(ctx: Ctx, input: Record<string, unknown>): Promise<AccessCheckResult> {
  const { query, projectId } = parse(accessCheckSchema, input);
  if (projectId) await requireProjectRef(ctx, projectId);
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
