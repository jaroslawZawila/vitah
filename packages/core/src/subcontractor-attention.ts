import {
  and,
  asc,
  db,
  eq,
  inArray,
  isNull,
  or,
  sql,
  subcontractorAssignments,
  subcontractors,
  type AnyColumn,
  type SQL,
} from "@repo/db";
import { logWarn } from "./log";
import {
  holdsUntil,
  HOLDS_FOREVER,
  MANDATORY_COMPANY_REQUIREMENTS,
  docState,
  nextStateChange,
  requirement,
  workerName,
  type AttentionItem,
  type CompanyStatus,
  type DocState,
  type RequirementId,
} from "./contract";
import { todayInSpain } from "./obra-calc";
import type { Tx } from "./project-client";
import { liveAssignment, loadNetwork, type CompanyRow, type Network } from "./subcontractor-network";

// ─── What needs attention, and its stored count ──────────────────────────────
// The CAE warnings (`attentionItems`) are worked out by the rules in
// ./subcontractor-rules.ts, in TypeScript: the one definition. So that the
// project list needn't load every document to count them, their result is
// stored: each company's status (`subcontractors.cae_status`) and the warnings
// each obra assignment gives its obra (`subcontractor_assignments.cae_warnings`),
// each with the last day it holds (`cae_valid_until`: the day before an expiry
// or an alert window could change it with no write at all).
//
// - Every write those values depend on goes through `caeTransaction` (or calls
//   `refreshCae` in its own): it locks the companies' rows first and refreshes
//   their values before committing.
// - A read refreshes the values that are missing or past their day
//   (`refreshStale`), whoever reads: they are derived, so no audit, no markChanged.
// - Only live assignments get values; a refresh clears the company's others,
//   so an assignment that comes back (assigned again, restored, its obra
//   restored) is worked out again on its first read.
// ─────────────────────────────────────────────────────────────────────────────

// What needs doing first: expired, rejected, missing, awaiting validation,
// requested, then expiring soonest.
const ATTENTION_ORDER: DocState[] = ["expired", "rejected", "missing", "uploaded", "requested", "expiring"];

export function attentionItems(net: Network): AttentionItem[] {
  const companies = new Map(net.companies.map((c) => [c.id, c]));
  const workers = new Map(net.workers.map((w) => [w.id, w]));
  const items: AttentionItem[] = [];

  for (const doc of net.docs) {
    const req = requirement(doc.requirementId);
    const company = companies.get(doc.subcontractorId);
    if (!req || !company || company.suppliesOnly) continue;
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
  for (const company of net.companies.filter((c) => !c.suppliesOnly)) {
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

// ─── The stored values ───────────────────────────────────────────────────────

export type CaeValues = {
  companies: { id: string; status: CompanyStatus; validUntil: string }[];
  assignments: { id: string; subcontractorId: string; warnings: number; validUntil: string }[];
};

/**
 * What to store for the network's companies and their live assignments: each
 * company's status, and the items `attentionItems` gives an obra from each
 * company on it (its own documents' and its workers', plus that obra's), as
 * `listProjectAttention` lists them. Each holds until the day before the
 * soonest day a document it reads can change state by the calendar alone.
 */
export function caeValues(net: Network): CaeValues {
  // Items and the next change, by company and obra (`id|`: the company's own and its workers').
  const items = new Map<string, number>();
  for (const item of attentionItems(net)) {
    const key = `${item.subcontractorId}|${item.projectId ?? ""}`;
    items.set(key, (items.get(key) ?? 0) + 1);
  }
  const next = new Map<string, string>();
  const nextOwn = new Map<string, string>();
  const sooner = (map: Map<string, string>, key: string, day: string | null) => {
    const known = map.get(key);
    if (day && (!known || day < known)) map.set(key, day);
  };
  for (const doc of net.docs) {
    const day = nextStateChange(doc.requirementId, net.facts(doc), net.today);
    sooner(next, `${doc.subcontractorId}|${doc.projectId ?? ""}`, day);
    if (!doc.workerId && !doc.projectId) sooner(nextOwn, doc.subcontractorId, day);
  }

  return {
    companies: net.companies.map((c) => ({
      id: c.id,
      status: net.status(c.id).status,
      validUntil: c.suppliesOnly ? HOLDS_FOREVER : holdsUntil(nextOwn.get(c.id) ?? null),
    })),
    assignments: net.assignments.map((a) => {
      const company = `${a.subcontractorId}|`;
      const obra = `${a.subcontractorId}|${a.projectId}`;
      const days = [next.get(company), next.get(obra)].filter((d): d is string => !!d).sort();
      return {
        id: a.id,
        subcontractorId: a.subcontractorId,
        warnings: (items.get(company) ?? 0) + (items.get(obra) ?? 0),
        validUntil: holdsUntil(days[0] ?? null),
      };
    }),
  };
}

/**
 * Locks the companies' rows, always in id order (so two transactions never
 * wait on each other in a circle). `no key update`: it keeps out another
 * refresh or CAE write, not the foreign-key checks of rows that point at the
 * company (an audit entry, an order), which never wait on it.
 */
async function lockCompanies(tx: Tx, tenantId: string, ids: string[]) {
  if (ids.length === 0) return;
  await tx
    .select({ id: subcontractors.id })
    .from(subcontractors)
    .where(and(eq(subcontractors.tenantId, tenantId), inArray(subcontractors.id, ids)))
    .orderBy(asc(subcontractors.id))
    .for("no key update");
}

/**
 * Works out the companies' values again and stores them, inside `tx`, which
 * holds their rows' locks (taken here if not yet). Their assignments that
 * aren't live get none (null), so a revived one is worked out on its first read.
 */
export async function refreshCae(tx: Tx, tenantId: string, ids: string[]) {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return;
  await lockCompanies(tx, tenantId, unique);
  const values = caeValues(await loadNetwork(tenantId, unique, { workers: false, exec: tx }));
  const rows = (list: SQL[]) => sql.join(list, sql`, `);
  if (values.companies.length > 0) {
    await tx.execute(sql`
      update ${subcontractors} as s set cae_status = v.status, cae_valid_until = v.until::date
      from (values ${rows(values.companies.map((c) => sql`(${c.id}, ${c.status}, ${c.validUntil})`))}) as v(id, status, until)
      where s.id = v.id and s.tenant_id = ${tenantId}`);
  }
  if (values.assignments.length > 0) {
    // soft-delete-ok(subcontractorAssignments): by id, the live assignments (of live obras) that loadNetwork just read under the company lock.
    await tx.execute(sql`
      update ${subcontractorAssignments} as a set cae_warnings = v.warnings::int, cae_valid_until = v.until::date
      from (values ${rows(values.assignments.map((a) => sql`(${a.id}, ${a.warnings}, ${a.validUntil})`))}) as v(id, warnings, until)
      where a.id = v.id and a.tenant_id = ${tenantId}`);
  }
  const live = values.assignments.map((a) => a.id);
  // soft-delete-ok(subcontractorAssignments): clears the derived values of the removed assignments and of deleted obras', so a revived one is worked out again.
  await tx.execute(sql`
    update ${subcontractorAssignments} set cae_warnings = null, cae_valid_until = null
    where tenant_id = ${tenantId} and ${inArray(subcontractorAssignments.subcontractorId, unique)}
      and cae_valid_until is not null ${live.length > 0 ? sql`and not ${inArray(subcontractorAssignments.id, live)}` : sql``}`);
}

/**
 * A write to what the companies' CAE values are worked out from (their
 * documents and versions, workers, assignments, the company itself), in one
 * transaction: their rows locked first, their values refreshed last.
 */
export function caeTransaction<T>(tenantId: string, ids: string[], write: (tx: Tx) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await lockCompanies(tx, tenantId, ids);
    const result = await write(tx);
    await refreshCae(tx, tenantId, ids);
    return result;
  });
}

/**
 * Forgets the stored values of the tenant's companies (or of `ids`), so that
 * the next read works them out: for what writes their documents past the
 * services (the seeds).
 */
export async function forgetCae(tenantId: string, ids?: string[]) {
  const only = (column: AnyColumn) => (ids ? inArray(column, ids) : undefined);
  await db.execute(sql`
    update ${subcontractors} set cae_status = null, cae_valid_until = null
    where ${and(eq(subcontractors.tenantId, tenantId), only(subcontractors.id))}`);
  // soft-delete-ok(subcontractorAssignments): forgets derived values, the removed assignments' and deleted obras' too (they hold none to keep).
  await db.execute(sql`
    update ${subcontractorAssignments} set cae_warnings = null, cae_valid_until = null
    where ${and(eq(subcontractorAssignments.tenantId, tenantId), only(subcontractorAssignments.subcontractorId))}`);
}

/** A stored value that was never worked out, or no longer holds today. */
const stale = (validUntil: AnyColumn, today: string) => or(isNull(validUntil), sql`${validUntil} < ${today}::date`)!;

/**
 * Refreshes those of the companies whose values are missing or past their day:
 * the company's own, or one of its live assignments'. Each company is locked
 * and checked again first, so of two reads at once one works it out and the
 * other finds it done, and a write in progress is waited for, never undone.
 */
export async function refreshStale(tenantId: string, ids: string[]) {
  if (ids.length === 0) return;
  const today = todayInSpain();
  await db.transaction(async (tx) => {
    await lockCompanies(tx, tenantId, ids);
    const due = await tx
      .select({ id: subcontractors.id })
      .from(subcontractors)
      .where(
        and(
          eq(subcontractors.tenantId, tenantId),
          inArray(subcontractors.id, ids),
          or(
            stale(subcontractors.caeValidUntil, today),
            inArray(
              subcontractors.id,
              tx
                .select({ id: subcontractorAssignments.subcontractorId })
                .from(subcontractorAssignments)
                .where(and(liveAssignment(tenantId), stale(subcontractorAssignments.caeValidUntil, today))),
            ),
          ),
        ),
      );
    await refreshCae(tx, tenantId, due.map((c) => c.id));
  });
}

/**
 * How many CAE warnings each obra has (`listProjectAttention`'s items), by
 * project id, from the stored values: one grouped sum over the live
 * assignments, after refreshing the stale ones. An obra without companies is
 * absent; one whose companies give none has 0.
 */
export async function countProjectsAttention(tenantId: string, projectIds: string[]): Promise<Map<string, number>> {
  if (projectIds.length === 0) return new Map();
  const a = subcontractorAssignments;
  const sum = (today: string) =>
    db
      .select({
        projectId: a.projectId,
        warnings: sql<number>`coalesce(sum(${a.caeWarnings}), 0)::int`,
        stale: sql<string[] | null>`array_agg(distinct ${a.subcontractorId}) filter (where ${stale(a.caeValidUntil, today)})`,
      })
      .from(a)
      .where(and(inArray(a.projectId, projectIds), liveAssignment(tenantId)))
      .groupBy(a.projectId);
  let rows = await sum(todayInSpain());
  // A value revived (an assignment restored) between the refresh and the sum is refreshed once more.
  for (let attempt = 0; attempt < 2; attempt++) {
    const due = rows.flatMap((r) => r.stale ?? []);
    if (due.length === 0) break;
    await refreshStale(tenantId, due);
    rows = await sum(todayInSpain());
  }
  // Still stale after two refreshes (restores racing this read again and again): the sum may count a value
  // not worked out as 0. Never silently: the next read corrects it, and this line says it happened.
  const left = rows.flatMap((r) => r.stale ?? []).length;
  if (left > 0) logWarn("cae.count_stale", undefined, { companies: left });
  return new Map(rows.map((r) => [r.projectId, r.warnings]));
}
