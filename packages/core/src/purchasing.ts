import {
  and,
  asc,
  db,
  desc,
  eq,
  inArray,
  projects,
  purchaseInvoiceLines,
  purchaseInvoices,
  purchaseOrderEvents,
  purchaseOrderLines,
  purchaseOrders,
  purchaseRequests,
  purchaseDocumentChecks,
  isNotNull,
  sql,
  subcontractors,
  users,
  type SQL,
} from "@repo/db";
import { toCalendarDate } from "./calendar";
import { requireEditor, type Ctx } from "./context";
import {
  CONTINGENCY_CHAPTER,
  MAX_ORDER_LINES,
  MAX_PAYMENT_DAYS,
  MAX_RETENTION_BP,
  PURCHASE_KINDS,
  PURCHASE_PROGRESS,
  PURCHASE_VAT_KINDS,
  UPCOMING_DAYS,
  canCancel,
  canTakeOrder,
  countsAsContracted,
  isCompletedOrder,
  isOpenOrder,
  maskIdNumber,
  placedStatus,
  statusesOf,
  type LineContracting,
  type ProjectPurchaseLines,
  type ProjectPurchases,
  type PurchaseForm,
  type PurchaseKind,
  type PurchaseLineItem,
  type PurchaseOrderDetail,
  type PurchaseOrderLine,
  type PurchaseOrderListItem,
  type PurchaseProgress,
  type PurchaseStatus,
  type PurchaseUpcoming,
  type TenantPurchases,
} from "./contract";
import { contractSchedule, contractTotals, daysPast, deviation, lateDays, type LineContract } from "./control-calc";
import { orderByDate, templateLeadDays } from "./planning-calc";
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
import { addDays, todayInSpain } from "./obra-calc";
import {
  calendarDate,
  fail,
  groupBy,
  integer,
  isObject,
  loadBudget,
  loadObra,
  optionalText,
  orNull,
  pick,
  pickChanges,
  requiredText,
  requireProject,
  userName,
  workDate,
} from "./obra-data";
import { projectInTenant, type Tx } from "./project-client";
import { loadNetwork, requireCompany, type Network } from "./subcontractor-network";

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
// pending, never cancelled).
// ─────────────────────────────────────────────────────────────────────────────

export const MAX_DESCRIPTION = 500;
export const MAX_NOTES = 2000;
export const MAX_NOTE = 500;
export const MAX_AMOUNT_CENTS = 2_000_000_000;
export const MAX_EVENTS = 500;

type OrderRow = typeof purchaseOrders.$inferSelect;
type LineRow = typeof purchaseOrderLines.$inferSelect;
type NewLine = Pick<LineRow, "lineageId" | "chapterCode" | "amountCents" | "closesLine">;

// ─── Loading ─────────────────────────────────────────────────────────────────

const inTenant = (ctx: Ctx) => eq(purchaseOrders.tenantId, ctx.tenantId);

/** Orders with their supplier, project and lines, newest first. */
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
    .where(and(eq(purchaseOrders.tenantId, tenantId), where))
    .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.number));
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
export function toListItem(loaded: LoadedOrder, net: Network | null, today: string): PurchaseOrderListItem {
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

/** The suppliers' CAE network, for the orders' list. */
function networkOf(tenantId: string, orders: LoadedOrder[]) {
  const ids = [...new Set(orders.map((o) => o.order.subcontractorId))];
  return ids.length > 0 ? loadNetwork(tenantId, ids) : null;
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
 * The project's contract at cost, chapter 20 aside, with each chapter's state,
 * planned dates (the Planning baseline, else simulated) and the day its orders
 * must go out by.
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
  const chapters = items.map((item) => {
    const plannedStart = plan.get(item.code)?.start ?? null;
    // A chapter the baseline lacks has no dates: the standard lead time stands in.
    const leadDays = plan.get(item.code)?.leadDays ?? templateLeadDays(item.code);
    return {
      ...item,
      state: states.get(item.code)!,
      plannedStart,
      plannedEnd: plan.get(item.code)?.end ?? null,
      leadDays,
      orderBy: plannedStart ? orderByDate(plannedStart, leadDays) : null,
    };
  });
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

const sumOf = (list: PurchaseOrderListItem[]) => list.reduce((total, o) => total + o.amountCents, 0);

/** The tenant's projects, for the lists' filter. */
export const projectList = (tenantId: string) =>
  db
    .select({ id: projects.id, ref: projects.ref, address: projects.address })
    .from(projects)
    .where(eq(projects.tenantId, tenantId))
    .orderBy(asc(projects.ref));

/** Every order of the tenant, with the totals Administration watches. */
export async function listPurchases(ctx: Ctx): Promise<TenantPurchases> {
  const [loaded, projectRows] = await Promise.all([
    loadOrders(ctx.tenantId, undefined, { documents: true }),
    projectList(ctx.tenantId),
  ]);
  // Only the suppliers with orders: not the tenant's whole network.
  const net = await networkOf(ctx.tenantId, loaded);
  const today = todayInSpain();
  const orders = loaded.map((o) => toListItem(o, net, today));
  const year = today.slice(0, 4);
  const thisYear = orders.filter(
    (o) => countsAsContracted(o.status) && (o.orderedOn ?? o.createdAt).slice(0, 4) === year,
  );
  const open = orders.filter((o) => isOpenOrder(o.status));
  const pending = orders.filter((o) => o.status === "pending");
  return {
    orders,
    projects: projectRows,
    summary: {
      yearContractedCents: sumOf(thisYear),
      yearOrders: thisYear.length,
      yearProjects: new Set(thisYear.map((o) => o.projectId)).size,
      openCents: sumOf(open),
      openOrders: open.length,
      pendingCents: sumOf(pending),
      pendingOrders: pending.length,
      lateDeliveries: orders.filter((o) => o.lateDays !== null).length,
    },
    today,
  };
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

/** The project's Compras tab: its orders, what is contracted against the budget, and what to order soon. */
export async function getProjectPurchases(ctx: Ctx, projectId: string): Promise<ProjectPurchases> {
  const [plan, loaded] = await Promise.all([
    contractPlan(ctx.tenantId, projectId),
    loadOrders(ctx.tenantId, ofProject(projectId), { documents: true }),
  ]);
  const net = await networkOf(ctx.tenantId, loaded);
  const today = todayInSpain();
  const orders = loaded.map((o) => toListItem(o, net, today));
  const contracts = contractsOf(loaded, today);
  const pendingOrders = orders.filter((o) => o.status === "pending");
  const horizon = addDays(today, UPCOMING_DAYS);

  const upcoming: PurchaseUpcoming[] = [];
  for (const chapter of plan.chapters) {
    const { uncontractedLines, uncontractedCostCents } = contractTotals(chapter.lines, contracts);
    const { orderBy } = chapter;
    const soon = chapter.state === "in_progress" || (orderBy !== null && orderBy <= horizon);
    if (uncontractedLines === 0 || chapter.state === "finished" || !soon) continue;
    upcoming.push({
      code: chapter.code,
      name: chapter.name,
      state: chapter.state,
      plannedStart: chapter.plannedStart,
      leadDays: chapter.leadDays,
      orderBy,
      orderLateDays: daysPast(orderBy, today),
      uncontractedLines,
      uncontractedCostCents,
      pendingOrders: pendingOrders
        .filter((o) => o.chapterCodes.includes(chapter.code))
        .map((o) => ({ id: o.id, number: o.number })),
    });
  }
  // What must go out first, first.
  upcoming.sort((a, b) => (a.orderBy ?? "").localeCompare(b.orderBy ?? "") || a.code.localeCompare(b.code));

  return {
    ref: plan.ref,
    orders,
    summary: contractSummary(plan, orders, contracts),
    upcoming,
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
      orderBy: chapter.orderBy,
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
    loadNetwork(ctx.tenantId),
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
      orderBy: chapter.orderBy,
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

/** The tenant's order; `not_found` otherwise. */
export async function requireOrder(ctx: Ctx, orderId: string) {
  const order = await db.query.purchaseOrders.findFirst({ where: and(eq(purchaseOrders.id, orderId), inTenant(ctx)) });
  if (!order) fail("not_found");
  return order;
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
    loadNetwork(ctx.tenantId, order.subcontractorId),
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
export async function requireSupplier(ctx: Ctx, subcontractorId: unknown, kind: PurchaseKind) {
  if (typeof subcontractorId !== "string" || !subcontractorId) fail("missing_fields");
  const [row] = await db
    .select({ id: subcontractors.id, suppliesOnly: subcontractors.suppliesOnly })
    .from(subcontractors)
    .where(and(eq(subcontractors.id, subcontractorId), eq(subcontractors.tenantId, ctx.tenantId)));
  if (!row) fail("unknown_supplier");
  if (!canTakeOrder(row, kind)) fail("supplies_only");
  return row.id;
}

/** The order's lines: each a contract line once, with an amount; `closesLine` defaults to true. */
export function parseLines(value: unknown, contract: Awaited<ReturnType<typeof contractLines>>): NewLine[] {
  if (!Array.isArray(value) || value.length === 0) fail("missing_fields");
  if (value.length > MAX_ORDER_LINES) fail("invalid_input");
  const seen = new Set<string>();
  return value.map((entry) => {
    if (!isObject(entry) || typeof entry.lineageId !== "string") fail("invalid_input");
    const line = contract.get(entry.lineageId);
    if (!line) fail("unknown_line");
    if (seen.has(entry.lineageId)) fail("invalid_input");
    seen.add(entry.lineageId);
    if (entry.closesLine !== undefined && typeof entry.closesLine !== "boolean") fail("invalid_input");
    return {
      lineageId: entry.lineageId,
      chapterCode: line.chapterCode,
      amountCents: integer(entry.amountCents, 1, MAX_AMOUNT_CENTS),
      closesLine: entry.closesLine ?? true,
    };
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

const FIELD_PARSERS = {
  description: (value: unknown) => requiredText(value, MAX_DESCRIPTION),
  orderedOn: orNull(workDate),
  expectedOn: orNull(calendarDate),
  workStart: orNull(calendarDate),
  workEnd: orNull(calendarDate),
  notes: (value: unknown) => optionalText(value, MAX_NOTES),
  // Its invoices' terms: null = the defaults.
  paymentDays: orNull((value) => integer(value, 0, MAX_PAYMENT_DAYS)),
  retentionBp: (value: unknown) => integer(value ?? 0, 0, MAX_RETENTION_BP),
  vatKind: orNull(pick(PURCHASE_VAT_KINDS)),
};

/** Whether the order has invoices (credit notes too); in `run`, after locking the order. */
async function hasInvoices(run: Tx | typeof db, tenantId: string, orderId: string) {
  const [row] = await run
    .select({ id: purchaseInvoices.id })
    .from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.tenantId, tenantId), eq(purchaseInvoices.orderId, orderId)))
    .limit(1);
  return row !== undefined;
}

/** What the order's invoices (credit notes net) put on each budget line, by lineage. */
async function invoicedByLineage(run: Tx, tenantId: string, orderId: string) {
  const rows = await run
    .select({ lineageId: purchaseInvoiceLines.lineageId, cents: sql<number>`sum(${purchaseInvoiceLines.amountCents})::int` })
    .from(purchaseInvoiceLines)
    .innerJoin(purchaseInvoices, eq(purchaseInvoices.id, purchaseInvoiceLines.invoiceId))
    .where(and(eq(purchaseInvoiceLines.tenantId, tenantId), eq(purchaseInvoices.orderId, orderId)))
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
  const before = await tx.select().from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, orderId)).for("update");
  const changes = diffLines(before, lines, contract);
  if (changes.length > 0) {
    await tx.delete(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, orderId));
    await tx.insert(purchaseOrderLines).values(lines.map((l) => ({ ...l, tenantId: ctx.tenantId, orderId })));
  }
  return { before, changes };
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
 * request it comes from) }. → { orderId, number }
 */
export async function createPurchase(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  await requireProject(ctx.tenantId, projectId);
  const kind = pick(PURCHASE_KINDS)(input.kind);
  const [subcontractorId, contract] = await Promise.all([
    requireSupplier(ctx, input.subcontractorId, kind),
    contractLines(ctx.tenantId, projectId),
  ]);
  const lines = parseLines(input.lines, contract);
  // null or absent: an order of its own; else an approved request's id.
  const requestId = input.requestId ?? null;
  if (requestId !== null && (typeof requestId !== "string" || requestId === "")) fail("invalid_input");
  const status = input.status === undefined ? "pending" : pick(["pending", placedStatus(kind)])(input.status);
  const parsed = pickChanges(input, FIELD_PARSERS);
  if (parsed.description === undefined) fail("missing_fields");
  const fields = checkDates({
    kind,
    subcontractorId,
    description: parsed.description,
    orderedOn: parsed.orderedOn ?? (status === "pending" ? null : todayInSpain()),
    expectedOn: parsed.expectedOn ?? null,
    workStart: parsed.workStart ?? null,
    workEnd: parsed.workEnd ?? null,
    notes: parsed.notes ?? null,
    paymentDays: parsed.paymentDays ?? null,
    retentionBp: parsed.retentionBp ?? 0,
    vatKind: parsed.vatKind ?? null,
  });
  const sameProject = and(ofProject(projectId), inTenant(ctx));
  const amountCents = lines.reduce((sum, l) => sum + l.amountCents, 0);
  // Two orders made at once may take the same number: the later one tries the next.
  for (let attempt = 0; attempt < 5; attempt++) {
    const made = await db.transaction(async (tx) => {
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
      if (!row) return null;
      await tx.insert(purchaseOrderLines).values(lines.map((l) => ({ ...l, tenantId: ctx.tenantId, orderId: row.id })));
      if (requestId) await orderRequest(tx, ctx, projectId, requestId, row);
      await logEvent(tx, ctx, row.id, "created", { number: row.number, status, amountCents, lines: lines.length, ...(requestId ? { requestId } : {}) });
      return { orderId: row.id, number: row.number };
    });
    if (made) return made;
  }
  throw new Error("Could not number the order");
}

/**
 * Body: any of { description, subcontractorId, orderedOn, expectedOn,
 * workStart, workEnd, notes, paymentDays, retentionBp, vatKind, kind (only
 * while pending), lines }. An invoiced order keeps its supplier and the lines
 * its invoices are split across. Each change is logged with its previous
 * value. → { orderId }
 */
export async function updatePurchase(ctx: Ctx, orderId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const order = await requireOrder(ctx, orderId);
  // A cancelled order is history; reopen it (setPurchaseStatus) to change it.
  if (order.status === "cancelled") fail("invalid_state");
  const kind = input.kind === undefined ? order.kind : pick(PURCHASE_KINDS)(input.kind);
  if (kind !== order.kind && order.status !== "pending") fail("invalid_state");
  const [subcontractorId, contract] = await Promise.all([
    input.subcontractorId === undefined && kind === order.kind
      ? order.subcontractorId
      : requireSupplier(ctx, input.subcontractorId ?? order.subcontractorId, kind),
    "lines" in input ? contractLines(ctx.tenantId, order.projectId) : null,
  ]);
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
    ...pickChanges(input, FIELD_PARSERS),
  });
  const changed = Object.fromEntries(
    (Object.keys(fields) as (keyof OrderFields)[])
      .filter((key) => fields[key] !== order[key])
      .map((key) => [key, { from: order[key], to: fields[key] }]),
  );
  const lines = contract ? parseLines(input.lines, contract) : null;

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
      const { changes } = await replaceOrderLines(tx, ctx, orderId, lines, contract);
      if (changes.length > 0) await logEvent(tx, ctx, orderId, "lines", { changes });
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
  const status = pick(statusesOf(order.kind))(input.status);
  if (status === order.status) fail("invalid_state");
  if (status === "cancelled" && !canCancel(order.status)) fail("invalid_state");
  const date = orNull(workDate)(input.date);
  const note = optionalText(input.note, MAX_NOTE);
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
