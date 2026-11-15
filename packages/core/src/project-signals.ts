import { and, db, eq, inArray, lt, purchaseOrders, purchaseRequests, sql } from "@repo/db";
import { toCalendarDate } from "./calendar";
import type { Ctx } from "./context";
import {
  isOpenOrder,
  PROJECT_ATTENTION_KINDS,
  statusesOf,
  type ChapterState,
  type ProjectAttention,
  type ProjectAttentionKind,
  type ProjectSignals,
} from "./contract";
import { milestoneState } from "./control-calc";
import { todayInSpain } from "./obra-calc";
import { loadObraSummaries, type ObraSummary } from "./obra-data";
import { obraContract, obraSchedule } from "./planning";
import { settledInvoices } from "./purchase-invoices";
import { projectSchedule } from "./schedule-status";
import { countProjectsAttention } from "./subcontractors";

// ─── Project signals ─────────────────────────────────────────────────────────
// What the Proyectos list shows of each obra so staff can tell which needs them
// today: whether it is on time, how much is built, and what waits for someone.
// Each is read from where the platform already works it out (the Obra tab's
// schedule and hitos, Compras, Subcontratas), for every project at once: a
// fixed number of queries, however many obras (`loadObraSummaries`,
// `countProjectsAttention` and three grouped counts), all sent at once.
// Read-only, all staff.
// ─────────────────────────────────────────────────────────────────────────────

type Project = { id: string; startDate: Date | null; completionDate: Date | null };

/** Per project: supplier invoices overdue (as Compras › Facturas' "overdue") and what they still owe. */
async function overdueInvoices(tenantId: string, today: string) {
  const rows = await db.execute<{ project_id: string; count: number; owed: string }>(sql`
    with st as (${settledInvoices(tenantId, {}, today)})
    select project_id, count(*)::int as count, coalesce(sum(greatest(outstanding, 0)), 0)::bigint as owed
    from st where state = 'overdue' group by project_id`);
  return new Map(rows.map((r) => [r.project_id, { count: r.count, amountCents: Number(r.owed) }]));
}

/** A material order still open: placed and not delivered (`lateDays`'s `isOpenOrder`). */
const OPEN_MATERIAL = statusesOf("material").filter(isOpenOrder);

/** Per project: material orders past their expected day and not delivered (`lateDays`, as the Obra tab's warning). */
async function lateDeliveries(tenantId: string, projectIds: string[], today: string) {
  const rows = await db
    .select({ projectId: purchaseOrders.projectId, count: sql<number>`count(*)::int` })
    .from(purchaseOrders)
    .where(
      and(
        eq(purchaseOrders.tenantId, tenantId),
        inArray(purchaseOrders.projectId, projectIds),
        eq(purchaseOrders.kind, "material"),
        inArray(purchaseOrders.status, OPEN_MATERIAL),
        lt(purchaseOrders.expectedOn, today),
      ),
    )
    .groupBy(purchaseOrders.projectId);
  return new Map(rows.map((r) => [r.projectId, r.count]));
}

/** Per project: purchase requests waiting for an admin's decision. */
async function pendingRequests(tenantId: string, projectIds: string[]) {
  const rows = await db
    .select({ projectId: purchaseRequests.projectId, count: sql<number>`count(*)::int` })
    .from(purchaseRequests)
    .where(and(eq(purchaseRequests.tenantId, tenantId), inArray(purchaseRequests.projectId, projectIds), eq(purchaseRequests.status, "pending")))
    .groupBy(purchaseRequests.projectId);
  return new Map(rows.map((r) => [r.projectId, r.count]));
}

/**
 * The hitos as Obra › Hitos states them (`milestoneState`): reached or requested
 * means to invoice; invoiced and past its due day (Pagos' "vence el") unpaid.
 */
function hitoCounts(obra: ObraSummary, states: ReadonlyMap<string, ChapterState>, today: string) {
  let toInvoice = 0;
  let overdue = 0;
  for (const hito of obra.hitos) {
    const state = milestoneState({
      chapterStates: hito.chapters.filter((c) => states.has(c.code)).map((c) => states.get(c.code)!),
      requested: obra.requests.some((r) => r.hitoId === hito.id),
      invoicedOn: hito.invoicedOn,
      paidOn: hito.paidOn,
    });
    if (state === "reached" || state === "requested") toInvoice++;
    if (state === "invoiced" && hito.dueOn !== null && hito.dueOn < today) overdue++;
  }
  return { toInvoice, overdue };
}

/** Each project's signals, by id. `projects` are the tenant's live ones (as `listProjects`). */
export async function projectSignals(ctx: Ctx, projects: Project[]): Promise<Map<string, ProjectSignals>> {
  const ids = projects.map((p) => p.id);
  if (ids.length === 0) return new Map();
  const today = todayInSpain();
  const [obras, documents, invoices, deliveries, requests] = await Promise.all([
    loadObraSummaries(ctx.tenantId, ids),
    countProjectsAttention(ctx, ids),
    overdueInvoices(ctx.tenantId, today),
    lateDeliveries(ctx.tenantId, ids, today),
    pendingRequests(ctx.tenantId, ids),
  ]);

  return new Map(
    projects.map((p) => {
      const obra = obras.get(p.id)!;
      const counts: Partial<Record<ProjectAttentionKind, number>> = {
        requests: requests.get(p.id),
        supplier_overdue: invoices.get(p.id)?.count,
        late_deliveries: deliveries.get(p.id),
        documents: documents.get(p.id),
      };
      // Only an obra with a contract has a schedule and a built %.
      let schedule: ProjectSignals["schedule"] = null;
      if (obra.contracted) {
        const works = { startDate: toCalendarDate(p.startDate), completionDate: toCalendarDate(p.completionDate) };
        const contract = obraContract(obra, works);
        schedule = projectSchedule(obraSchedule(obra, works, today, contract));
        const hitos = hitoCounts(obra, contract.states, today);
        counts.to_invoice = hitos.toInvoice;
        counts.collection_overdue = hitos.overdue;
      }
      const attention = PROJECT_ATTENTION_KINDS.flatMap((kind): ProjectAttention[] => {
        const count = counts[kind] ?? 0;
        if (count === 0) return [];
        return kind === "supplier_overdue" ? [{ kind, count, amountCents: invoices.get(p.id)!.amountCents }] : [{ kind, count }];
      });
      return [p.id, { schedule, progressPct: obra.contracted ? obra.progress.progressPct : null, attention }] as const;
    }),
  );
}
