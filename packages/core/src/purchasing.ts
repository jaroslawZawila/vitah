import {
  and,
  asc,
  db,
  desc,
  eq,
  ilike,
  inArray,
  lt,
  or,
  projects,
  purchaseInvoiceLines,
  purchaseInvoices,
  purchaseOrderEvents,
  purchaseOrderLines,
  purchaseOrderMilestones,
  purchaseOrders,
  purchaseRequests,
  purchaseDocumentChecks,
  isNotNull,
  isNull,
  sql,
  subcontractors,
  users,
  type SQL,
} from "@repo/db";
import { toCalendarDate } from "./calendar";
import { requireEditor, type Ctx } from "./context";
import {
  CONTINGENCY_CHAPTER,
  PURCHASE_FLOWS,
  PURCHASE_PROGRESS,
  canCancel,
  canTakeOrder,
  countsAsContracted,
  isCompletedOrder,
  isOpenOrder,
  maskIdNumber,
  placedStatus,
  purchaseOrderGroup,
  type LineContracting,
  type ProjectPurchaseLines,
  type ProjectPurchases,
  type PurchaseForm,
  type PurchaseKind,
  type PurchaseLineItem,
  type PurchaseListQuery,
  type PurchaseOrderDetail,
  type PurchaseOrderLine,
  type PurchaseOrderListItem,
  type PurchaseOrderGroup,
  type PurchaseProgress,
  type PurchaseStatus,
  type TenantPurchases,
} from "./contract";
import { contractSchedule, contractTotals, deviation, lateDays, type LineContract } from "./control-calc";
import { idempotent, type Once } from "./idempotency";
import { changesOf, parse } from "./inputs/fields";
import {
  newOrderSchemas,
  orderChangesSchema,
  orderKindSchema,
  purchaseListSchema,
  statusChangeSchemas,
  type OrderLines,
} from "./inputs/purchasing";
import { MAX_AMOUNT_CENTS } from "./money";
import { allPages, filterText, pageWindow, pagingOf, searchPattern } from "./paging";
import { orderLabelSql } from "./sql-labels";
import { loadDocuments, ordersWithDocuments } from "./purchase-document-data";
import { loadAmendments } from "./purchase-amendment-data";
import { loadChecks } from "./purchase-check-data";
import { orderRequest, reopenRequestOf } from "./purchase-request-data";
import { addInvoicing, isDueSoon, purchaseProgress, termsOf } from "./purchase-calc";
import {
  buildInvoices,
  groupsOfOrder,
  invoicedByOrder,
  invoicingByLine,
  itemsOfOrder,
  loadInvoices,
  loadMilestones,
  orderInvoicing,
  orderMilestones,
} from "./purchase-invoice-data";
import { todayInSpain } from "./obra-calc";
import { fail, groupBy, loadBudget, loadObra, requireProject, userName } from "./obra-data";
import { projectInTenant, projectNotDeleted, projectsInTenant, type Tx } from "./project-client";
import { loadCompanyStatuses, requireCompany, type Network } from "./subcontractor-network";

// ─── Purchasing (Compras) ────────────────────────────────────────────────────
// A project's orders of material and subcontracts. Each splits its amount
// across budget lines (by lineage, so it outlives a budget revision) and may
// close a line: nothing more is left to contract for it. A line's contracted
// amount is the sum of its orders from ordered / contracted on (pending and
// cancelled ones don't count); its deviation counts only once it is closed,
// so a half-contracted line never shows as a saving. The Obra tab reads it
// (`loadProjectOrders`). Suppliers are the Subcontratas companies, material
// suppliers included. Every change is logged. Staff only: admins and
// managers write, viewers read; the client's app never sees it. Suppliers'
// invoices and payments are ./purchase-invoices; once an order has invoices
// it keeps its supplier, its invoiced lines and its place (never back to
// pending, never cancelled). Soft delete: an invoice a user deleted stays in
// its table and counts for none of that; a deleted obra's orders are left out
// of every read.
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_EVENTS = 500;
const MAX_MILESTONE_CONCEPT = 200;
/** The milestone a rise by an edit adds to the payment schedule; staff rename it on the order's page. */
const EDIT_MILESTONE_CONCEPT = "Ajuste por corrección del pedido";

type OrderRow = typeof purchaseOrders.$inferSelect;
type LineRow = typeof purchaseOrderLines.$inferSelect;
type NewLine = Pick<LineRow, "lineageId" | "chapterCode" | "amountCents" | "closesLine">;

// ─── Loading ─────────────────────────────────────────────────────────────────

const inTenant = (ctx: Ctx) => eq(purchaseOrders.tenantId, ctx.tenantId);

/** Orders with their supplier, project and lines, newest first; those of a deleted obra aside. */
/** `documents`: whether each has documents (the lists' `hasFile`); else false. */
export async function loadOrders(tenantId: string, where?: SQL, { documents = false } = {}) {
  const rows = await db
    .select({
      order: purchaseOrders,
      supplierName: subcontractors.legalName,
      suppliesOnly: subcontractors.suppliesOnly,
      projectRef: projects.ref,
    })
    .from(purchaseOrders)
    .innerJoin(subcontractors, eq(subcontractors.id, purchaseOrders.subcontractorId))
    .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .where(and(eq(purchaseOrders.tenantId, tenantId), projectNotDeleted(), where))
    .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.number), desc(purchaseOrders.id));
  const ids = rows.map((r) => r.order.id);
  const [lineRows, invoiced, documented] = await Promise.all([
    ids.length === 0
      ? []
      : db
          .select()
          .from(purchaseOrderLines)
          .where(and(eq(purchaseOrderLines.tenantId, tenantId), inArray(purchaseOrderLines.orderId, ids))),
    invoicedByOrder(tenantId, ids),
    documents ? ordersWithDocuments(tenantId, ids) : new Set<string>(),
  ]);
  const lines = groupBy(lineRows, (l) => l.orderId);
  return rows.map((row) => ({
    ...row,
    lines: lines.get(row.order.id) ?? [],
    invoicedCents: invoiced.get(row.order.id) ?? 0,
    hasFile: documented.has(row.order.id),
  }));
}

type LoadedOrder = Awaited<ReturnType<typeof loadOrders>>[number];

/** `net` gives the supplier's CAE status; without it, null. */
export function toListItem(loaded: LoadedOrder, net: Pick<Network, "status"> | null, today: string): PurchaseOrderListItem {
  const { order, lines } = loaded;
  return {
    id: order.id,
    projectId: order.projectId,
    projectRef: loaded.projectRef,
    number: order.number,
    kind: order.kind,
    subcontractorId: order.subcontractorId,
    supplierName: loaded.supplierName,
    suppliesOnly: loaded.suppliesOnly,
    caeStatus: net ? net.status(order.subcontractorId).status : null,
    description: order.description,
    status: order.status,
    orderedOn: order.orderedOn,
    expectedOn: order.expectedOn,
    workStart: order.workStart,
    workEnd: order.workEnd,
    completedOn: order.completedOn,
    amountCents: lines.reduce((sum, l) => sum + l.amountCents, 0),
    chapterCodes: [...new Set(lines.map((l) => l.chapterCode))].sort(),
    lateDays: lateDays(order, today),
    invoicedCents: loaded.invoicedCents,
    hasFile: loaded.hasFile,
    createdAt: order.createdAt.toISOString(),
  };
}

/** The CAE status of the orders' suppliers, for their list: their own documents, not their workers'. */
function networkOf(tenantId: string, orders: LoadedOrder[]) {
  const ids = [...new Set(orders.map((o) => o.order.subcontractorId))];
  return ids.length > 0 ? loadCompanyStatuses(tenantId, ids) : null;
}

/**
 * What each budget line (by lineage) has contracted, from `orders`: the sum
 * of the counting ones, and whether one of them closes it. Lines nothing is
 * contracted for aren't in the map. `except` leaves an order out (the one
 * being edited).
 */
export function contractsOf(orders: LoadedOrder[], today: string, except?: string) {
  const contracts = new Map<string, LineContract>();
  const counting = orders
    .filter((o) => o.order.id !== except && countsAsContracted(o.order.status))
    .sort((a, b) => a.order.number - b.order.number);
  for (const { order, lines, supplierName } of counting) {
    for (const line of lines) {
      const contract = contracts.get(line.lineageId) ?? { contractedCents: 0, closed: false, orders: [] };
      contract.contractedCents += line.amountCents;
      contract.closed ||= line.closesLine;
      contract.orders.push({ id: order.id, number: order.number, supplierName, lateDays: lateDays(order, today) });
      contracts.set(line.lineageId, contract);
    }
  }
  return contracts;
}

export const ofProject = (projectId: string) => eq(purchaseOrders.projectId, projectId);

/**
 * A project's orders (without their suppliers' CAE status) and what each
 * budget line has contracted: what the Obra tab reads, in one load.
 */
export async function loadProjectOrders(tenantId: string, projectId: string) {
  const loaded = await loadOrders(tenantId, ofProject(projectId));
  const today = todayInSpain();
  return { orders: loaded.map((o) => toListItem(o, null, today)), contracts: contractsOf(loaded, today) };
}

/** A line's state of contracting. */
export const contractingOf = (contract: LineContract | undefined): LineContracting =>
  !contract ? "none" : contract.closed ? "closed" : "open";

/**
 * The project's contract at cost, chapter 20 aside, with each chapter's state
 * and planned dates (the Planning baseline, else simulated).
 */
async function contractPlan(tenantId: string, projectId: string) {
  const [project, obra] = await Promise.all([
    db.query.projects.findFirst({
      where: projectInTenant(tenantId, projectId),
      columns: { ref: true, startDate: true, completionDate: true },
    }),
    loadObra(tenantId, projectId),
  ]);
  if (!project) fail("project_not_found");
  const works = { startDate: toCalendarDate(project.startDate), completionDate: toCalendarDate(project.completionDate) };
  const { items, states, plan, planSource } = contractSchedule(obra.costChapters, obra.hitos, obra.progressRows, works, obra.planDates);
  const chapters = items.map((item) => ({
    ...item,
    state: states.get(item.code)!,
    plannedStart: plan.get(item.code)?.start ?? null,
    plannedEnd: plan.get(item.code)?.end ?? null,
  }));
  return { ref: project.ref, budgetNumber: obra.revision?.number ?? null, chapters, planSource };
}

/** The contract's budget lines by lineage, for checking an order's lines. */
export async function contractLines(tenantId: string, projectId: string) {
  const { costChapters } = await loadBudget(tenantId, projectId);
  return new Map(
    costChapters
      .filter((c) => c.code !== CONTINGENCY_CHAPTER)
      .flatMap((c) => c.lines.map((line) => [line.lineageId, { ...line, chapterCode: c.code }] as const)),
  );
}

// ─── Reads ───────────────────────────────────────────────────────────────────

const sumOf = (list: { amountCents: number }[]) => list.reduce((total, o) => total + o.amountCents, 0);

/** The tenant's projects, for the lists' filter. */
export const projectList = (tenantId: string) =>
  db
    .select({ id: projects.id, ref: projects.ref, address: projects.address })
    .from(projects)
    .where(projectsInTenant(tenantId))
    .orderBy(asc(projects.ref));

const ORDER_STATUSES: PurchaseStatus[] = [...new Set([...PURCHASE_FLOWS.material, ...PURCHASE_FLOWS.subcontract, "cancelled" as const])];
const statusesIn = (group: PurchaseOrderGroup) => ORDER_STATUSES.filter((status) => purchaseOrderGroup(status) === group);
const inGroup = (group: PurchaseOrderGroup) => inArray(purchaseOrders.status, statusesIn(group));
const CONTRACTED = ORDER_STATUSES.filter(countsAsContracted);

/** As ./control-calc's `lateDays`: a material order placed, not delivered, past its expected day. */
const isLate = (today: string) => and(eq(purchaseOrders.kind, "material"), inGroup("open"), lt(purchaseOrders.expectedOn, today))!;
/** The day an order counts from: its order date, or the day it was created while pending. */
const orderDay = sql`coalesce(${purchaseOrders.orderedOn}, (${purchaseOrders.createdAt})::date)`;
/** An order's amount: its lines'. */
const orderAmount = sql`(select coalesce(sum(l.amount_cents), 0) from ${purchaseOrderLines} l where l.order_id = ${purchaseOrders.id})`;

/**
 * The tenant's orders, newest first, with the totals Administration watches.
 * `query` asks for a page of them and narrows them (see `PurchaseListQuery`);
 * without one, all of them come (up to `MAX_UNPAGED`: `paging.truncated` says
 * when that cut them), as before lists were paged. Filtering, counting and the totals happen in the database: only the
 * page's orders are loaded. The totals are the whole tenant's, whatever the
 * filters.
 */
export async function listPurchases(ctx: Ctx, query: PurchaseListQuery = {}): Promise<TenantPurchases> {
  const today = todayInSpain();
  const window = pageWindow(query);
  const filters = parse(purchaseListSchema, query);
  const group = filters.group ?? "all";
  const kind = filters.kind ?? "all";
  const { from, to, late } = filters;
  const pattern = searchPattern(query.q);
  const projectId = filterText(query.projectId);
  const supplierId = filterText(query.supplierId);

  const orderRows = () =>
    db
      .select({ id: purchaseOrders.id })
      .from(purchaseOrders)
      .innerJoin(subcontractors, eq(subcontractors.id, purchaseOrders.subcontractorId))
      .innerJoin(projects, eq(projects.id, purchaseOrders.projectId));
  const ofTenant = and(inTenant(ctx), projectNotDeleted());
  // Every filter but the group: the counts beside it are of each group.
  const kept = and(
    ofTenant,
    projectId ? eq(purchaseOrders.projectId, projectId) : undefined,
    supplierId ? eq(purchaseOrders.subcontractorId, supplierId) : undefined,
    kind === "all" ? undefined : eq(purchaseOrders.kind, kind),
    from ? sql`${orderDay} >= ${from}::date` : undefined,
    to ? sql`${orderDay} <= ${to}::date` : undefined,
    late ? isLate(today) : undefined,
    pattern
      ? or(
          sql`${orderLabelSql(purchaseOrders.number)} ilike ${pattern}`,
          ilike(subcontractors.legalName, pattern),
          ilike(purchaseOrders.description, pattern),
          ilike(projects.ref, pattern),
        )
      : undefined,
  );
  const shown = and(kept, group === "all" ? undefined : inGroup(group));
  const year = today.slice(0, 4);
  const thisYear = and(inArray(purchaseOrders.status, CONTRACTED), sql`to_char(${orderDay}, 'YYYY') = ${year}`)!;
  const cents = (where: SQL) => sql<number>`coalesce(sum(${orderAmount}) filter (where ${where}), 0)`.mapWith(Number);
  const many = (where: SQL) => sql<number>`(count(*) filter (where ${where}))::int`;

  const [ids, [counts], [totals], supplierRows, projectRows, bySupplier] = await Promise.all([
    orderRows()
      .where(shown)
      .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.number), desc(purchaseOrders.id))
      .limit(window.limit)
      .offset(window.offset),
    db
      .select({
        all: sql<number>`count(*)::int`,
        open: many(inGroup("open")),
        pending: many(inGroup("pending")),
        done: many(inGroup("done")),
        cancelled: many(inGroup("cancelled")),
        // What the orders shown contract (pending and cancelled ones don't add up).
        contractedCents: cents(and(inArray(purchaseOrders.status, CONTRACTED), group === "all" ? undefined : inGroup(group))!),
      })
      .from(purchaseOrders)
      .innerJoin(subcontractors, eq(subcontractors.id, purchaseOrders.subcontractorId))
      .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
      .where(kept),
    db
      .select({
        yearContractedCents: cents(thisYear),
        yearOrders: many(thisYear),
        yearProjects: sql<number>`(count(distinct ${purchaseOrders.projectId}) filter (where ${thisYear}))::int`,
        openCents: cents(inGroup("open")),
        openOrders: many(inGroup("open")),
        pendingCents: cents(inGroup("pending")),
        pendingOrders: many(inGroup("pending")),
        lateDeliveries: many(isLate(today)),
        lateProjectRefs: sql<string[] | null>`array_agg(distinct ${projects.ref}) filter (where ${isLate(today)})`,
      })
      .from(purchaseOrders)
      .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
      .where(ofTenant),
    db
      .selectDistinct({ id: subcontractors.id, name: subcontractors.legalName })
      .from(purchaseOrders)
      .innerJoin(subcontractors, eq(subcontractors.id, purchaseOrders.subcontractorId))
      .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
      .where(ofTenant),
    projectList(ctx.tenantId),
    query.by === "supplier"
      ? db
          .select({
            id: subcontractors.id,
            name: subcontractors.legalName,
            suppliesOnly: subcontractors.suppliesOnly,
            orders: sql<number>`count(*)::int`,
            projectRefs: sql<string[]>`array_agg(distinct ${projects.ref})`,
            contractedCents: cents(inArray(purchaseOrders.status, CONTRACTED)),
            openCents: cents(inGroup("open")),
          })
          .from(purchaseOrders)
          .innerJoin(subcontractors, eq(subcontractors.id, purchaseOrders.subcontractorId))
          .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
          .where(shown)
          .groupBy(subcontractors.id, subcontractors.legalName, subcontractors.suppliesOnly)
      : undefined,
  ]);

  const position = new Map(ids.map((row, index) => [row.id, index]));
  const loaded =
    ids.length === 0 ? [] : await loadOrders(ctx.tenantId, inArray(purchaseOrders.id, [...position.keys()]), { documents: true });
  loaded.sort((a, b) => position.get(a.order.id)! - position.get(b.order.id)!);
  // Only the suppliers on the page: not the tenant's whole network.
  const net = await networkOf(ctx.tenantId, loaded);
  const { contractedCents = 0, ...groupCounts } = counts ?? { all: 0, open: 0, pending: 0, done: 0, cancelled: 0 };
  const byName = <T extends { name: string }>(a: T, b: T) => a.name.localeCompare(b.name);
  return {
    orders: loaded.map((o) => toListItem(o, net, today)),
    paging: pagingOf(window, groupCounts[group]),
    groupCounts,
    shownContractedCents: contractedCents,
    suppliers: supplierRows.sort(byName),
    ...(bySupplier && {
      bySupplier: bySupplier
        .map((g) => ({ ...g, projectRefs: [...g.projectRefs].sort(), contractedCents: g.contractedCents, openCents: g.openCents }))
        .sort((a, b) => b.contractedCents - a.contractedCents || byName(a, b)),
    }),
    projects: projectRows,
    summary: {
      yearContractedCents: totals?.yearContractedCents ?? 0,
      yearOrders: totals?.yearOrders ?? 0,
      yearProjects: totals?.yearProjects ?? 0,
      openCents: totals?.openCents ?? 0,
      openOrders: totals?.openOrders ?? 0,
      pendingCents: totals?.pendingCents ?? 0,
      pendingOrders: totals?.pendingOrders ?? 0,
      lateDeliveries: totals?.lateDeliveries ?? 0,
      lateProjectRefs: [...(totals?.lateProjectRefs ?? [])].sort(),
    },
    today,
  };
}

/**
 * Every order `filters` keep, newest first: all of them, however many (the
 * CSV export). Read a page at a time, so no cap cuts it; a tenant with more
 * than `MAX_ALL_ROWS` fails instead of exporting a part (see `allPages`).
 */
export async function listAllPurchases(ctx: Ctx, filters: Omit<PurchaseListQuery, "page" | "limit" | "by"> = {}): Promise<PurchaseOrderListItem[]> {
  return allPages(
    async (page) => {
      // Whatever came with the filters, never a page of its own nor the suppliers' breakdown.
      const { orders, paging } = await listPurchases(ctx, { ...filters, by: undefined, ...page });
      return { rows: orders, paging };
    },
    { key: (order) => order.id },
  );
}

/** One supplier's orders, across the tenant's projects (its Subcontratas ficha). */
export async function listSupplierOrders(ctx: Ctx, subcontractorId: string): Promise<PurchaseOrderListItem[]> {
  const [loaded] = await Promise.all([
    loadOrders(ctx.tenantId, eq(purchaseOrders.subcontractorId, subcontractorId), { documents: true }),
    requireCompany(ctx, subcontractorId),
  ]);
  const today = todayInSpain();
  return loaded.map((o) => toListItem(o, null, today));
}

/** The project's Compras tab: its orders and what is contracted against the budget. */
export async function getProjectPurchases(ctx: Ctx, projectId: string): Promise<ProjectPurchases> {
  const [plan, loaded] = await Promise.all([
    contractPlan(ctx.tenantId, projectId),
    loadOrders(ctx.tenantId, ofProject(projectId), { documents: true }),
  ]);
  const net = await networkOf(ctx.tenantId, loaded);
  const today = todayInSpain();
  const orders = loaded.map((o) => toListItem(o, net, today));
  const contracts = contractsOf(loaded, today);
  return {
    ref: plan.ref,
    orders,
    summary: contractSummary(plan, orders, contracts),
    today,
    sources: { planning: plan.planSource },
  };
}

/** The obra's contract at cost against what its orders contract. */
function contractSummary(
  plan: Awaited<ReturnType<typeof contractPlan>>,
  orders: PurchaseOrderListItem[],
  contracts: Map<string, LineContract>,
): ProjectPurchases["summary"] {
  const lines = plan.chapters.flatMap((c) => c.lines);
  const totals = contractTotals(lines, contracts);
  return {
    costCents: lines.reduce((sum, l) => sum + l.amountCents, 0),
    contractedCents: totals.contractedCents,
    closedLines: totals.closedLines,
    deviationCents: totals.deviationCents,
    deviationBp: totals.deviationBp,
    toContractCents: totals.uncontractedCostCents,
    uncontractedLines: totals.uncontractedLines,
    pendingOrders: orders.filter((o) => o.status === "pending").length,
    lateDeliveries: orders.filter((o) => o.lateDays !== null).length,
  };
}

/**
 * The obra's Compras by budget line: each line's cost, what is contracted,
 * invoiced and paid of it and where that leaves it (the four states), with
 * the orders behind it, their milestones and invoices; the obra's totals
 * (without VAT) and its invoices past due or due soon.
 */
export async function getProjectPurchaseLines(ctx: Ctx, projectId: string): Promise<ProjectPurchaseLines> {
  const [plan, loaded, invoices, milestones] = await Promise.all([
    contractPlan(ctx.tenantId, projectId),
    loadOrders(ctx.tenantId, ofProject(projectId)),
    loadInvoices(ctx.tenantId, ofProject(projectId)),
    loadMilestones(ctx.tenantId, ofProject(projectId)),
  ]);
  const today = todayInSpain();
  const contracts = contractsOf(loaded, today);
  const built = buildInvoices(invoices, today);
  const byLine = invoicingByLine(built);
  const items = loaded.map((o) => toListItem(o, null, today));
  // Each order once: a line shows the whole order's schedule and invoices.
  const orderViews = new Map(
    loaded.map((o, i) => {
      const item = items[i]!;
      const view = {
        id: item.id,
        number: item.number,
        kind: item.kind,
        status: item.status,
        supplierName: item.supplierName,
        description: item.description,
        amountCents: item.amountCents,
        expectedOn: item.expectedOn,
        completedOn: item.completedOn,
        lateDays: item.lateDays,
        retentionBp: o.order.retentionBp,
        milestones: orderMilestones(milestones.get(item.id) ?? [], built),
        invoices: itemsOfOrder(built, item.id),
        invoicing: orderInvoicing(item.amountCents, groupsOfOrder(built, item.id)),
      };
      return [item.id, { view, lineAmounts: new Map(o.lines.map((l) => [l.lineageId, l.amountCents])) }];
    }),
  );
  const lineOrder = (orderId: string, lineageId: string) => {
    const { view, lineAmounts } = orderViews.get(orderId)!;
    return { ...view, lineAmountCents: lineAmounts.get(lineageId) ?? 0 };
  };

  const counts = Object.fromEntries(PURCHASE_PROGRESS.map((p) => [p, 0])) as Record<PurchaseProgress, number>;
  const chapters = plan.chapters.map((chapter) => {
    const lines = chapter.lines
      // A line that costs nothing and nobody ordered has nothing to buy.
      .filter((line) => line.amountCents > 0 || contracts.has(line.lineageId))
      .map((line): PurchaseLineItem => {
        const contract = contracts.get(line.lineageId);
        const invoicing = byLine.get(line.lineageId);
        const contractedCents = contract?.contractedCents ?? 0;
        const progress = purchaseProgress({
          contracted: contract !== undefined,
          closed: contract?.closed ?? false,
          contractedCents,
          invoicedCents: invoicing?.invoicedCents ?? 0,
          hasInvoices: invoicing !== undefined,
          settled: invoicing?.settled ?? true,
        });
        counts[progress]++;
        return {
          lineageId: line.lineageId,
          code: line.code,
          description: line.description,
          costCents: line.amountCents,
          contractedCents,
          contracting: contractingOf(contract),
          ...deviation(line.amountCents, contract?.closed ? contractedCents : null),
          uncontractedCents: contract?.closed ? 0 : Math.max(0, line.amountCents - contractedCents),
          progress,
          overdue: invoicing?.overdue ?? false,
          invoicedCents: invoicing?.invoicedCents ?? 0,
          paidCents: invoicing?.paidCents ?? 0,
          outstandingCents: invoicing?.outstandingCents ?? 0,
          retainedCents: invoicing?.retainedCents ?? 0,
          orders: (contract?.orders ?? []).map((o) => lineOrder(o.id, line.lineageId)),
        };
      });
    return {
      code: chapter.code,
      name: chapter.name,
      state: chapter.state,
      costCents: lines.reduce((sum, l) => sum + l.costCents, 0),
      contractedCents: lines.reduce((sum, l) => sum + l.contractedCents, 0),
      deviationCents: contractTotals(chapter.lines, contracts).deviationCents,
      lines,
    };
  });

  const groups = [...built.groups.values()];
  const listed = [...built.items.values()];
  const dueAlerts = listed
    .filter((i) => i.state === "overdue" || isDueSoon(i, today))
    .sort((a, b) => (a.dueOn ?? "").localeCompare(b.dueOn ?? ""));
  return {
    ref: plan.ref,
    summary: {
      ...contractSummary(plan, items, contracts),
      ...addInvoicing(groups.map((g) => g.settlement.base)),
      overdueCents: groups
        .filter((g) => built.items.get(g.invoice.invoice.id)?.state === "overdue")
        .reduce((sum, g) => sum + g.settlement.base.outstandingCents, 0),
      invoices: listed.filter((i) => i.kind === "invoice").length,
      creditNotes: listed.filter((i) => i.kind === "credit_note").length,
    },
    counts,
    dueAlerts,
    chapters,
    today,
    sources: { planning: plan.planSource },
  };
}

/**
 * What a new order picks from: the suppliers and the contract's lines, with
 * what is already contracted. `orderId`: editing that one (its own amounts
 * left out, the order as it stands in `editing`).
 */
export async function getPurchaseForm(ctx: Ctx, projectId: string, orderId?: string): Promise<PurchaseForm> {
  const [plan, loaded, net] = await Promise.all([
    contractPlan(ctx.tenantId, projectId),
    loadOrders(ctx.tenantId, ofProject(projectId)),
    // Every company to pick from, with its status: none of their workers.
    loadCompanyStatuses(ctx.tenantId),
  ]);
  const edited = orderId ? loaded.find((o) => o.order.id === orderId) : undefined;
  if (orderId && !edited) fail("not_found");
  const contracts = contractsOf(loaded, todayInSpain(), orderId);
  return {
    ref: plan.ref,
    nextNumber: Math.max(0, ...loaded.map((o) => o.order.number)) + 1,
    editing: edited
      ? {
          id: edited.order.id,
          number: edited.order.number,
          kind: edited.order.kind,
          status: edited.order.status,
          subcontractorId: edited.order.subcontractorId,
          description: edited.order.description,
          orderedOn: edited.order.orderedOn,
          expectedOn: edited.order.expectedOn,
          workStart: edited.order.workStart,
          workEnd: edited.order.workEnd,
          notes: edited.order.notes,
          paymentDays: edited.order.paymentDays,
          retentionBp: edited.order.retentionBp,
          vatKind: edited.order.vatKind,
          lines: edited.lines.map(({ lineageId, amountCents, closesLine }) => ({ lineageId, amountCents, closesLine })),
        }
      : null,
    suppliers: net.companies.map((c) => {
      const status = net.status(c.id);
      return {
        id: c.id,
        legalName: c.legalName,
        taxIdMasked: maskIdNumber(c.taxId),
        kind: c.kind,
        suppliesOnly: c.suppliesOnly,
        status: status.status,
        missing: [...status.expired, ...status.pending],
        trades: c.trades,
      };
    }),
    chapters: plan.chapters.map((chapter) => ({
      code: chapter.code,
      name: chapter.name,
      state: chapter.state,
      plannedStart: chapter.plannedStart,
      plannedEnd: chapter.plannedEnd,
      lines: chapter.lines.map((line) => {
        const contract = contracts.get(line.lineageId);
        return {
          lineageId: line.lineageId,
          code: line.code,
          description: line.description,
          unit: line.unit,
          quantity: line.quantity,
          costCents: line.amountCents,
          contractedCents: contract?.contractedCents ?? 0,
          closed: contract?.closed ?? false,
        };
      }),
    })),
    today: todayInSpain(),
    sources: { planning: plan.planSource },
  };
}

/** The tenant's order, of an obra not deleted; `not_found` otherwise. */
export async function requireOrder(ctx: Ctx, orderId: string) {
  const [row] = await db
    .select({ order: purchaseOrders })
    .from(purchaseOrders)
    .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .where(and(eq(purchaseOrders.id, orderId), inTenant(ctx), projectNotDeleted()));
  if (!row) fail("not_found");
  return row.order;
}

/** The first document's current version: the single PDF older clients know. */
function firstVersion(documents: { versions: { filename: string; sizeBytes: number }[] }[] | undefined) {
  const current = documents?.[0]?.versions[0];
  return current ? { name: current.filename, sizeBytes: current.sizeBytes } : null;
}

/** The day each status was last reached, from the order's history (oldest first). */
function reachedOn(events: { action: string; detail: Record<string, unknown>; createdAt: Date }[]) {
  const reached: Partial<Record<PurchaseStatus, string>> = {};
  for (const event of events) {
    const day = todayInSpain(event.createdAt);
    if (event.action === "created") reached.pending = day;
    if (event.action !== "status") continue;
    // Placing and completing carry the day it happened; the other steps, the day they were recorded.
    const date = event.detail.date;
    reached[event.detail.to as PurchaseStatus] = typeof date === "string" ? date : day;
  }
  return reached;
}

/** One order: its lines against the budget, its chapters on the obra, and its history. */
export async function getPurchase(ctx: Ctx, orderId: string): Promise<PurchaseOrderDetail> {
  const order = await requireOrder(ctx, orderId);
  const [plan, projectOrders, events, [creator], net, invoices, milestones, documents, [request], amendments, checks] = await Promise.all([
    contractPlan(ctx.tenantId, order.projectId),
    loadOrders(ctx.tenantId, ofProject(order.projectId)),
    db
      .select({ event: purchaseOrderEvents, by: userName })
      .from(purchaseOrderEvents)
      .leftJoin(users, eq(users.id, purchaseOrderEvents.userId))
      .where(and(eq(purchaseOrderEvents.orderId, orderId), eq(purchaseOrderEvents.tenantId, ctx.tenantId)))
      .orderBy(desc(purchaseOrderEvents.createdAt))
      .limit(MAX_EVENTS),
    order.createdById
      ? db.select({ by: userName }).from(users).where(eq(users.id, order.createdById))
      : Promise.resolve([]),
    loadCompanyStatuses(ctx.tenantId, [order.subcontractorId]),
    loadInvoices(ctx.tenantId, eq(purchaseInvoices.orderId, orderId)),
    loadMilestones(ctx.tenantId, eq(purchaseOrders.id, orderId)),
    loadDocuments(ctx.tenantId, [orderId]),
    db
      .select({ id: purchaseRequests.id, number: purchaseRequests.number })
      .from(purchaseRequests)
      .where(and(eq(purchaseRequests.tenantId, ctx.tenantId), eq(purchaseRequests.orderId, orderId))),
    loadAmendments(ctx.tenantId, orderId),
    loadChecks(ctx.tenantId, and(eq(purchaseDocumentChecks.orderId, orderId), isNotNull(purchaseDocumentChecks.documentVersionId))!),
  ]);
  const today = todayInSpain();
  const loaded = projectOrders.find((o) => o.order.id === orderId)!;
  const built = buildInvoices(invoices, today);
  const schedule = orderMilestones(milestones.get(orderId) ?? [], built);
  const others = contractsOf(projectOrders, today, orderId);
  // A pending or cancelled order contracts nothing: its lines show what the others contracted.
  const counts = countsAsContracted(order.status);
  const budgetLines = new Map(plan.chapters.flatMap((c) => c.lines.map((line) => [line.lineageId, line] as const)));
  const codeOf = (line: LineRow) => budgetLines.get(line.lineageId)?.code ?? line.chapterCode;
  const lines = [...loaded.lines]
    .sort((a, b) => codeOf(a).localeCompare(codeOf(b)))
    .map((line): PurchaseOrderLine => {
      const budget = budgetLines.get(line.lineageId);
      const other = others.get(line.lineageId);
      const otherCents = other?.contractedCents ?? 0;
      const closed = (counts && line.closesLine) || (other?.closed ?? false);
      return {
        id: line.id,
        lineageId: line.lineageId,
        chapterCode: line.chapterCode,
        code: budget?.code ?? null,
        description: budget?.description ?? null,
        unit: budget?.unit ?? null,
        quantity: budget?.quantity ?? null,
        costCents: budget?.amountCents ?? null,
        amountCents: line.amountCents,
        closesLine: line.closesLine,
        otherCents,
        ...deviation(budget?.amountCents ?? 0, budget && closed ? otherCents + (counts ? line.amountCents : 0) : null),
      };
    });
  const codes = new Set(lines.map((l) => l.chapterCode));
  const item = toListItem(loaded, net, today);
  return {
    ...item,
    notes: order.notes,
    lines,
    documents: documents.get(orderId) ?? [],
    hasFile: (documents.get(orderId) ?? []).length > 0,
    file: firstVersion(documents.get(orderId)),
    chapters: plan.chapters.filter((c) => codes.has(c.code)).map((c) => ({ code: c.code, name: c.name, state: c.state })),
    createdBy: creator?.by ?? null,
    events: events.map(({ event, by }) => ({
      id: event.id,
      action: event.action,
      detail: event.detail,
      note: event.note,
      by,
      at: event.createdAt.toISOString(),
    })),
    reached: reachedOn(events.map((e) => e.event).reverse()),
    budgetNumber: plan.budgetNumber,
    request: request ?? null,
    amendments,
    checks,
    // Before its modificados: what they changed taken back off (edits since are corrections of it).
    originalAmountCents: item.amountCents - amendments.reduce((sum, a) => sum + a.amountAfterCents - a.amountBeforeCents, 0),
    terms: termsOf(order),
    milestones: schedule,
    invoices: [...built.items.values()],
    invoicing: orderInvoicing(item.amountCents, [...built.groups.values()]),
    today,
  };
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/** The tenant's company or material supplier, able to take an order of `kind`. */
export async function requireSupplier(ctx: Ctx, subcontractorId: string, kind: PurchaseKind) {
  const [row] = await db
    .select({ id: subcontractors.id, suppliesOnly: subcontractors.suppliesOnly })
    .from(subcontractors)
    .where(and(eq(subcontractors.id, subcontractorId), eq(subcontractors.tenantId, ctx.tenantId)));
  if (!row) fail("unknown_supplier");
  if (!canTakeOrder(row, kind)) fail("supplies_only");
  return row.id;
}

/** The order's lines as parsed (./inputs/purchasing's `orderLinesSchema`): each a line of the contract, once. */
export function contractedLines(given: OrderLines, contract: Awaited<ReturnType<typeof contractLines>>): NewLine[] {
  const seen = new Set<string>();
  return given.map(({ lineageId, amountCents, closesLine }) => {
    const line = contract.get(lineageId);
    if (!line) fail("unknown_line");
    if (seen.has(lineageId)) fail("invalid_input");
    seen.add(lineageId);
    return { lineageId, chapterCode: line.chapterCode, amountCents, closesLine };
  });
}

type OrderFields = Pick<
  OrderRow,
  | "kind"
  | "subcontractorId"
  | "description"
  | "orderedOn"
  | "expectedOn"
  | "workStart"
  | "workEnd"
  | "notes"
  | "paymentDays"
  | "retentionBp"
  | "vatKind"
>;

/** Whether the order has invoices (credit notes too; deleted ones aside); in `run`, after locking the order. */
async function hasInvoices(run: Tx | typeof db, tenantId: string, orderId: string) {
  const [row] = await run
    .select({ id: purchaseInvoices.id })
    .from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.tenantId, tenantId), eq(purchaseInvoices.orderId, orderId), isNull(purchaseInvoices.deletedAt)))
    .limit(1);
  return row !== undefined;
}

/** What the order's invoices (credit notes net; deleted ones aside) put on each budget line, by lineage. */
async function invoicedByLineage(run: Tx, tenantId: string, orderId: string) {
  const rows = await run
    .select({ lineageId: purchaseInvoiceLines.lineageId, cents: sql<number>`sum(${purchaseInvoiceLines.amountCents})`.mapWith(Number) })
    .from(purchaseInvoiceLines)
    .innerJoin(purchaseInvoices, eq(purchaseInvoices.id, purchaseInvoiceLines.invoiceId))
    .where(and(eq(purchaseInvoiceLines.tenantId, tenantId), eq(purchaseInvoices.orderId, orderId), isNull(purchaseInvoices.deletedAt)))
    .groupBy(purchaseInvoiceLines.lineageId);
  return new Map(rows.map((r) => [r.lineageId, r.cents]));
}

/**
 * In `tx`, with the order locked: its lines become `lines` (an edit or a
 * modificado). The lines its invoices are split across stay (`has_invoices`),
 * never below what they invoiced (`below_invoiced`). → the lines before and
 * what changed (nothing written when nothing did).
 */
export async function replaceOrderLines(
  tx: Tx,
  ctx: Ctx,
  orderId: string,
  lines: NewLine[],
  contract: Awaited<ReturnType<typeof contractLines>>,
) {
  const invoiced = await invoicedByLineage(tx, ctx.tenantId, orderId);
  const next = new Map(lines.map((l) => [l.lineageId, l]));
  for (const [lineageId, cents] of invoiced) {
    const line = next.get(lineageId);
    if (!line) fail("has_invoices");
    if (line.amountCents < cents) fail("below_invoiced");
  }
  // In budget order: the log lists the changes the same way whatever order the rows are read in.
  const before = await tx
    .select()
    .from(purchaseOrderLines)
    .where(eq(purchaseOrderLines.orderId, orderId))
    .orderBy(asc(purchaseOrderLines.chapterCode), asc(purchaseOrderLines.lineageId))
    .for("update");
  const changes = diffLines(before, lines, contract);
  if (changes.length > 0) {
    await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, orderId));
    await tx.insert(purchaseOrderLines).values(lines.map((l) => ({ ...l, tenantId: ctx.tenantId, orderId })));
  }
  return { before, changes };
}

/**
 * In `tx`, before milestones are removed: the deleted invoices that were
 * theirs let go of them (the column is a foreign key; an invoice not deleted
 * locks its milestone, so only deleted ones can be left).
 */
export async function releaseMilestones(tx: Tx, milestoneIds: string[]) {
  if (milestoneIds.length === 0) return;
  await tx
    .update(purchaseInvoices)
    .set({ milestoneId: null })
    .where(and(inArray(purchaseInvoices.milestoneId, milestoneIds), isNotNull(purchaseInvoices.deletedAt)));
}

/**
 * In `tx`, with the order locked: its payment schedule, if any, follows a
 * change of `deltaCents` (an edit or a modificado): a rise is a milestone of
 * its own (`concept`), a cut comes off the last milestones with no invoice;
 * `milestones_cut` if those can't take it. → whether the schedule moved.
 */
export async function followSchedule(tx: Tx, ctx: Ctx, orderId: string, deltaCents: number, concept: string) {
  if (deltaCents === 0) return false;
  const milestones = await tx
    .select()
    .from(purchaseOrderMilestones)
    .where(eq(purchaseOrderMilestones.orderId, orderId))
    .orderBy(asc(purchaseOrderMilestones.position));
  if (milestones.length === 0) return false;
  // A rise is a milestone of its own, stored as an integer: each line fits, a change of the order's total may not.
  if (deltaCents > MAX_AMOUNT_CENTS) fail("invalid_input");
  if (deltaCents > 0) {
    const position = Math.max(...milestones.map((m) => m.position)) + 1;
    await tx.insert(purchaseOrderMilestones).values({ tenantId: ctx.tenantId, orderId, position, concept: concept.slice(0, MAX_MILESTONE_CONCEPT), amountCents: deltaCents });
    return true;
  }
  const invoiced = await tx
    .selectDistinct({ milestoneId: purchaseInvoices.milestoneId })
    .from(purchaseInvoices)
    .where(
      and(
        eq(purchaseInvoices.orderId, orderId),
        // A deleted invoice locks no milestone.
        isNull(purchaseInvoices.deletedAt),
        isNotNull(purchaseInvoices.milestoneId),
        inArray(purchaseInvoices.milestoneId, milestones.map((m) => m.id)),
      ),
    );
  const locked = new Set(invoiced.map((i) => i.milestoneId));
  let left = -deltaCents;
  for (const milestone of [...milestones].reverse()) {
    if (left === 0) break;
    if (locked.has(milestone.id)) continue;
    const taken = Math.min(left, milestone.amountCents);
    left -= taken;
    if (taken === milestone.amountCents) {
      await releaseMilestones(tx, [milestone.id]);
      await tx.delete(purchaseOrderMilestones).where(eq(purchaseOrderMilestones.id, milestone.id));
    } else await tx.update(purchaseOrderMilestones).set({ amountCents: milestone.amountCents - taken }).where(eq(purchaseOrderMilestones.id, milestone.id));
  }
  if (left > 0) fail("milestones_cut");
  return true;
}

/** A kind's own dates only: a delivery for material, a works period for a subcontract. */
function checkDates(fields: OrderFields): OrderFields {
  const own =
    fields.kind === "material" ? { ...fields, workStart: null, workEnd: null } : { ...fields, expectedOn: null };
  if (own.workStart && own.workEnd && own.workStart > own.workEnd) fail("invalid_date");
  return own;
}

export async function logEvent(
  tx: Tx,
  ctx: Ctx,
  orderId: string,
  action: string,
  detail: Record<string, unknown>,
  note: string | null = null,
) {
  await tx.insert(purchaseOrderEvents).values({ tenantId: ctx.tenantId, orderId, action, detail, note, userId: ctx.userId });
}

/**
 * Body: { kind, subcontractorId, description, lines: [{ lineageId,
 * amountCents, closesLine? }], status? (pending, or ordered / contracted to
 * place it now), orderedOn?, expectedOn?, workStart?, workEnd?, notes?,
 * paymentDays?, retentionBp?, vatKind?, requestId? (the approved purchase
 * request it comes from), idempotencyKey? (sent again with the same key, it
 * is one order with one number: ./idempotency) }. → { orderId, number }
 */
export async function createPurchase(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  return idempotent<{ orderId: string; number: number }>(ctx, "purchase.order.create", { projectId }, input, (once) => placeOrder(ctx, projectId, input, once));
}

async function placeOrder(ctx: Ctx, projectId: string, input: Record<string, unknown>, once: Once<{ orderId: string; number: number }>) {
  await requireProject(ctx.tenantId, projectId);
  const { kind } = parse(orderKindSchema, input);
  const schema = newOrderSchemas[kind];
  // The supplier before the rest, as always: one that can't take the kind answers first.
  const [subcontractorId, contract] = await Promise.all([
    requireSupplier(ctx, parse(schema.pick({ subcontractorId: true }), input).subcontractorId, kind),
    contractLines(ctx.tenantId, projectId),
  ]);
  const { lines: given, requestId: request, status, ...parsed } = parse(schema.omit({ subcontractorId: true }), input);
  const lines = contractedLines(given, contract);
  // null or absent: an order of its own; else an approved request's id.
  const requestId = request ?? null;
  const fields = checkDates({
    ...parsed,
    kind,
    subcontractorId,
    orderedOn: parsed.orderedOn ?? (status === "pending" ? null : todayInSpain()),
  });
  const sameProject = and(ofProject(projectId), inTenant(ctx));
  const amountCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  return db.transaction((tx) =>
    once(tx, async () => {
      // Two orders made at once may take the same number: the later one waits
      // for the first, then tries the next (each statement sees what is in by then).
      for (let attempt = 0; attempt < 5; attempt++) {
        const [row] = await tx
          .insert(purchaseOrders)
          .values({
            ...fields,
            status,
            tenantId: ctx.tenantId,
            projectId,
            number: sql`(select coalesce(max(${purchaseOrders.number}), 0) + 1 from ${purchaseOrders} where ${sameProject})`,
            createdById: ctx.userId,
          })
          .onConflictDoNothing()
          .returning({ id: purchaseOrders.id, number: purchaseOrders.number });
        if (!row) continue;
        await tx.insert(purchaseOrderLines).values(lines.map((l) => ({ ...l, tenantId: ctx.tenantId, orderId: row.id })));
        if (requestId) await orderRequest(tx, ctx, projectId, requestId, row);
        await logEvent(tx, ctx, row.id, "created", { number: row.number, status, amountCents, lines: lines.length, ...(requestId ? { requestId } : {}) });
        return { orderId: row.id, number: row.number };
      }
      throw new Error("Could not number the order");
    }),
  );
}

/**
 * Body: any of { description, subcontractorId, orderedOn, expectedOn,
 * workStart, workEnd, notes, paymentDays, retentionBp, vatKind, kind (only
 * while pending), lines }. An invoiced order keeps its supplier and the lines
 * its invoices are split across. When the lines change its amount, its
 * payment schedule follows as with a modificado (`followSchedule`: a rise is a
 * new milestone, a cut comes off the last ones not invoiced, or
 * `milestones_cut` and nothing changes). Each change is logged with its
 * previous value. → { orderId }
 */
export async function updatePurchase(ctx: Ctx, orderId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const order = await requireOrder(ctx, orderId);
  // A cancelled order is history; reopen it (setPurchaseStatus) to change it.
  if (order.status === "cancelled") fail("invalid_state");
  // The kind first: changing it is for a pending order only.
  const kind = parse(orderChangesSchema.pick({ kind: true }), input).kind ?? order.kind;
  if (kind !== order.kind && order.status !== "pending") fail("invalid_state");
  // The supplier next (sent, or the order's own under a new kind), then the rest.
  const { subcontractorId: supplierId } = parse(orderChangesSchema.pick({ subcontractorId: true }), input);
  const subcontractorId =
    supplierId === undefined && kind === order.kind
      ? order.subcontractorId
      : await requireSupplier(ctx, supplierId ?? order.subcontractorId, kind);
  const { lines: given, ...changes } = changesOf(parse(orderChangesSchema.omit({ kind: true, subcontractorId: true }), input));
  const contract = given ? await contractLines(ctx.tenantId, order.projectId) : null;
  const fields = checkDates({
    kind,
    subcontractorId,
    description: order.description,
    orderedOn: order.orderedOn,
    expectedOn: order.expectedOn,
    workStart: order.workStart,
    workEnd: order.workEnd,
    notes: order.notes,
    paymentDays: order.paymentDays,
    retentionBp: order.retentionBp,
    vatKind: order.vatKind,
    ...changes,
  });
  const changed = Object.fromEntries(
    (Object.keys(fields) as (keyof OrderFields)[])
      .filter((key) => fields[key] !== order[key])
      .map((key) => [key, { from: order[key], to: fields[key] }]),
  );
  const lines = given && contract ? contractedLines(given, contract) : null;

  await db.transaction(async (tx) => {
    // Locked and compared: a status change at the same time can't slip a kind change past its check.
    const [locked] = await tx
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId))
      .for("update");
    if (locked?.status !== order.status) fail("invalid_state");
    // Its invoices were the supplier's, split across its lines.
    if (fields.subcontractorId !== order.subcontractorId && (await hasInvoices(tx, ctx.tenantId, orderId))) {
      fail("has_invoices");
    }
    if (Object.keys(changed).length > 0) {
      await tx.update(purchaseOrders).set(fields).where(eq(purchaseOrders.id, orderId));
      await logEvent(tx, ctx, orderId, "updated", { fields: changed });
    }
    if (lines && contract) {
      const { before, changes } = await replaceOrderLines(tx, ctx, orderId, lines, contract);
      if (changes.length > 0) {
        const deltaCents = sumOf(lines) - sumOf(before);
        const followed = await followSchedule(tx, ctx, orderId, deltaCents, EDIT_MILESTONE_CONCEPT);
        // `scheduleDeltaCents`: what the payment schedule took with it.
        await logEvent(tx, ctx, orderId, "lines", { changes, ...(followed ? { scheduleDeltaCents: deltaCents } : {}) });
      }
    }
  });
  return { orderId };
}

/** What changed between an order's lines and their new version, by budget line. */
/** The lines that changed, by lineage: added, removed, a new amount, or closing differently. */
export function diffLines(before: NewLine[], after: NewLine[], contract: Awaited<ReturnType<typeof contractLines>>) {
  const old = new Map(before.map((l) => [l.lineageId, l]));
  const now = new Map(after.map((l) => [l.lineageId, l]));
  const shape = (l: NewLine | undefined) => (l ? { amountCents: l.amountCents, closesLine: l.closesLine } : null);
  return [...new Set([...old.keys(), ...now.keys()])]
    .filter((id) => {
      const a = old.get(id);
      const b = now.get(id);
      return !a || !b || a.amountCents !== b.amountCents || a.closesLine !== b.closesLine;
    })
    .map((id) => ({ code: contract.get(id)?.code ?? null, lineageId: id, from: shape(old.get(id)), to: shape(now.get(id)) }));
}

/**
 * Body: { status, date?, note? }. Moves the order to any status of its kind
 * (corrections included) or cancels it. Placing it (ordered / contracted)
 * records the order's date (`date`, or the one it had, or today); delivered /
 * finished records `date` (today by default) as the day it happened; either
 * may be before today, never after. → { orderId, status }
 */
export async function setPurchaseStatus(ctx: Ctx, orderId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const order = await requireOrder(ctx, orderId);
  const schema = statusChangeSchemas[order.kind];
  // The status first: the state checks come before the day and the note.
  const { status } = parse(schema.pick({ status: true }), input);
  if (status === order.status) fail("invalid_state");
  if (status === "cancelled" && !canCancel(order.status)) fail("invalid_state");
  const { date, note } = parse(schema, input);
  const placed = status !== "cancelled" && status !== "pending";
  let orderedOn = placed
    ? ((status === placedStatus(order.kind) ? date : null) ?? order.orderedOn ?? todayInSpain())
    : order.orderedOn;
  const completedOn = isCompletedOrder(status) ? (date ?? todayInSpain()) : null;
  // Never completed before it was placed.
  if (completedOn && orderedOn && completedOn < orderedOn) {
    if (order.orderedOn) fail("invalid_date");
    orderedOn = completedOn;
  }
  await db.transaction(async (tx) => {
    // Locked and compared: two status changes at once can't both move it from the same status.
    const [locked] = await tx
      .select({ status: purchaseOrders.status })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.id, orderId))
      .for("update");
    if (locked?.status !== order.status) fail("invalid_state");
    // An invoiced order stays placed: its invoices were against what it contracted.
    if (!countsAsContracted(status) && (await hasInvoices(tx, ctx.tenantId, orderId))) fail("has_invoices");
    await tx.update(purchaseOrders).set({ status, orderedOn, completedOn }).where(eq(purchaseOrders.id, orderId));
    // The date it records: the day it was placed or completed (none for the steps between).
    const day = completedOn ?? (status === placedStatus(order.kind) ? orderedOn : null);
    await logEvent(tx, ctx, orderId, "status", { from: order.status, to: status, date: day }, note);
    if (status === "cancelled") await reopenRequestOf(tx, ctx, order);
  });
  return { orderId, status };
}
