import {
  and,
  asc,
  db,
  desc,
  eq,
  inArray,
  isNull,
  or,
  projects,
  purchaseDocumentChecks,
  purchaseInvoiceFiles,
  purchaseInvoiceLines,
  purchaseInvoices,
  purchaseOrderEvents,
  purchaseOrderLines,
  purchaseOrderMilestones,
  purchaseOrders,
  purchasePayments,
  purchaseRequests,
  sql,
  type SQL,
  subcontractors,
  users,
} from "@repo/db";
import { isUniqueViolation } from "./accounts";
import { requireEditor, type Ctx } from "./context";
import {
  DUE_SOON_DAYS,
  MAX_IRPF_BP,
  MAX_MILESTONES,
  MAX_RETENTION_BP,
  PURCHASE_INVOICE_GROUPS,
  PURCHASE_INVOICE_KINDS,
  PURCHASE_PAYMENT_METHODS,
  PURCHASE_VAT_KINDS,
  countsAsContracted,
  type PurchaseInvoiceDetail,
  type InvoiceListQuery,
  type PurchaseInvoiceForm,
  type PurchaseInvoiceGroup,
  type PurchaseInvoiceKind,
  type PurchaseInvoiceListItem,
  type PurchasingCounts,
  type TenantInvoices,
  type TenantPayments,
} from "./contract";
import { requirePdf } from "./documents";
import { idempotent, type Once } from "./idempotency";
import { addDays, todayInSpain } from "./obra-calc";
import { filterText, pageWindow, pagingOf, searchPattern, type PageQuery } from "./paging";
import { orderLabelSql } from "./sql-labels";
import {
  calendarDate,
  fail,
  integer,
  isObject,
  loadBudget,
  optionalText,
  orNull,
  pick,
  pickChanges,
  requiredText,
  userName,
  workDate,
} from "./obra-data";
import { inLiveOrder, projectNotDeleted, softDeleted, type Tx } from "./project-client";
import { openStoredFile, projectFolder, storeFiles, uploadedName, type StoredFile } from "./project-files";
import {
  defaultDueOn,
  forecastWeeks,
  invoiceAmounts,
  isDueSoon,
  isOwed,
  settle,
  splitProportional,
  termsOf,
  withTotals,
} from "./purchase-calc";
import { loadChecks } from "./purchase-check-data";
import {
  buildInvoices,
  groupsOfOrder,
  invoicingByLine,
  itemsOfOrder,
  loadInvoices,
  loadMilestones,
  loadPayments,
  orderInvoicing,
  orderMilestones,
  paymentTotals,
} from "./purchase-invoice-data";
import { contractLines, loadOrders, logEvent, projectList, releaseMilestones, requireOrder } from "./purchasing";

// ─── Supplier invoices and payments (Compras) ────────────────────────────────
// Administration registers each supplier invoice once, against a placed
// order: its base (without VAT) split across the order's budget lines, its
// VAT, IRPF and guarantee retention, and its PDF in versions. An order with a
// payment schedule (milestones) has each invoice assigned to one. A credit
// note rectifies one invoice of the same order and settles against it.
// Payments add up against an invoice: first what is due, then the retention
// once released. The obra reads all of it by budget line (./purchasing).
// Every change goes to the order's log. Staff only: admins and managers
// write, viewers read; the client's app never sees it.
// Deleting an invoice or a payment is a soft delete (`deleted_at`,
// `deleted_by_id`): the row and its PDFs stay, and every read, sum and check
// leaves it out as if it were gone (so do the rows of a deleted obra).
// ─────────────────────────────────────────────────────────────────────────────

const MAX_NUMBER = 60;
const MAX_NOTES = 2000;
const MAX_CONCEPT = 200;
const MAX_REFERENCE = 120;
const MAX_FILE_NOTE = 300;
const MAX_AMOUNT_CENTS = 2_000_000_000;
const MAX_EVENTS = 500;

type InvoiceRow = typeof purchaseInvoices.$inferSelect;
type NewInvoiceLine = { lineageId: string; chapterCode: string; amountCents: number };

// ─── Loading ─────────────────────────────────────────────────────────────────

/** The tenant's invoice (or credit note), not deleted nor of a deleted obra; `not_found` otherwise. */
async function requireInvoice(ctx: Ctx, invoiceId: string) {
  const [row] = await db
    .select({ invoice: purchaseInvoices })
    .from(purchaseInvoices)
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseInvoices.orderId))
    .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .where(
      and(
        eq(purchaseInvoices.id, invoiceId),
        eq(purchaseInvoices.tenantId, ctx.tenantId),
        isNull(purchaseInvoices.deletedAt),
        projectNotDeleted(),
      ),
    );
  if (!row) fail("not_found");
  return row.invoice;
}

const owed = (i: PurchaseInvoiceListItem) => isOwed(i.state);
export const sumOwed = (list: PurchaseInvoiceListItem[]) => list.reduce((sum, i) => sum + Math.max(0, i.outstandingCents), 0);

/** The invoice whose payments settle `invoice`: its own, or a credit note's invoice. */
const payerOf = (invoice: InvoiceRow) => (invoice.kind === "invoice" ? invoice.id : invoice.rectifiesId!);

/** Owed first, soonest due first; then the settled ones, newest first. */
export function byUrgency(a: PurchaseInvoiceListItem, b: PurchaseInvoiceListItem) {
  if (owed(a) !== owed(b)) return owed(a) ? -1 : 1;
  if (owed(a)) return (a.dueOn ?? "").localeCompare(b.dueOn ?? "");
  return b.issuedOn.localeCompare(a.issuedOn) || b.createdAt.localeCompare(a.createdAt);
}

type Filters = { projectId?: string; subcontractorId?: string };

/** Invoices of a project or a supplier (whole orders either way). */
const invoiceFilter = (filters: Filters): SQL | undefined =>
  and(
    filters.projectId ? eq(purchaseOrders.projectId, filters.projectId) : undefined,
    filters.subcontractorId ? eq(purchaseInvoices.subcontractorId, filters.subcontractorId) : undefined,
  );

const monthStart = (today: string) => `${today.slice(0, 7)}-01`;

const OWED = sql`('pending', 'partial', 'overdue')`;

/**
 * What the invoice or credit note `row` (a table alias) leaves to pay by its
 * due date: its total less the retention held, as `withTotals`' `payableCents`.
 */
const payableOf = (row: string) => sql.raw(`(${row}.base_cents + ${row}.vat_cents - ${row}.irpf_cents - ${row}.retention_cents)`);

/**
 * Every invoice and credit note of the tenant (or of a project or supplier)
 * with how it stands today, worked out in the database as `settle` and
 * `invoiceState` do: what it owes (its payable amount, net of its credit
 * notes, less its payments; deleted ones aside) and its state. The lists
 * filter, count, add up and page on it; only a page's invoices are loaded.
 * The rule itself is TypeScript's (./purchase-calc); that this SQL agrees
 * with it for every invoice is tested ("one rule, two languages").
 */
export const settledInvoices = (tenantId: string, scope: Filters, today: string) => sql`
  select i.id, i.kind, i.order_id, i.subcontractor_id, i.number, i.due_on, i.issued_on, i.created_at,
    o.project_id, o.number as order_number, o.description as order_description, p.ref as project_ref, s.legal_name as supplier_name,
    x.outstanding,
    case when i.kind = 'credit_note' then 'credit' when x.outstanding <= 0 then 'paid'
      when i.due_on < ${today}::date then 'overdue' when x.paid > 0 then 'partial' else 'pending' end as state
  from ${purchaseInvoices} i
  join ${purchaseOrders} o on o.id = i.order_id
  join ${projects} p on p.id = o.project_id
  join ${subcontractors} s on s.id = i.subcontractor_id
  left join (
    select invoice_id, sum(amount_cents) as paid from ${purchasePayments}
    where tenant_id = ${tenantId} and deleted_at is null group by invoice_id
  ) pay on pay.invoice_id = i.id
  left join (
    select n.rectifies_id, sum(${payableOf("n")}) as payable from ${purchaseInvoices} n
    where n.tenant_id = ${tenantId} and n.kind = 'credit_note' and n.rectifies_id is not null and n.deleted_at is null group by n.rectifies_id
  ) cr on cr.rectifies_id = i.id
  cross join lateral (
    select coalesce(pay.paid, 0) as paid, ${payableOf("i")} + coalesce(cr.payable, 0) - coalesce(pay.paid, 0) as outstanding
  ) x
  where i.tenant_id = ${tenantId} and i.deleted_at is null and p.deleted_at is null
    ${scope.projectId ? sql`and o.project_id = ${scope.projectId}` : sql``}
    ${scope.subcontractorId ? sql`and i.subcontractor_id = ${scope.subcontractorId}` : sql``}`;

const INVOICE_GROUP_SQL: Record<PurchaseInvoiceGroup, SQL> = {
  open: sql`state in ${OWED}`,
  overdue: sql`state = 'overdue'`,
  paid: sql`state = 'paid'`,
  credit: sql`state = 'credit'`,
};

/** The invoices of these orders, built (each with its credit notes, settled). */
async function buildOrders(tenantId: string, orderIds: string[], today: string) {
  const ids = [...new Set(orderIds)];
  const loaded = ids.length === 0 ? [] : await loadInvoices(tenantId, inArray(purchaseInvoices.orderId, ids), { lines: false });
  return buildInvoices(loaded, today);
}

// ─── Reads ───────────────────────────────────────────────────────────────────

/**
 * Administration's invoices: the supplier invoices of the tenant (or of a
 * project or supplier: `filters`), owed first, with what is owed. `query`
 * asks for a page of them and narrows the list (see `InvoiceListQuery`);
 * without one, all of them come (up to `MAX_UNPAGED`), as before lists were
 * paged. The summary is that of every invoice of `filters`, whatever `query`.
 */
export async function listInvoices(ctx: Ctx, filters: Filters = {}, query: InvoiceListQuery = {}): Promise<TenantInvoices> {
  const today = todayInSpain();
  const window = pageWindow(query);
  const group = orNull(pick(["all", ...PURCHASE_INVOICE_GROUPS] as const))(query.group) ?? "all";
  const pattern = searchPattern(query.q);
  const projectId = filterText(query.projectId);
  const supplierId = filterText(query.supplierId);
  const settled = settledInvoices(ctx.tenantId, filters, today);
  // Every filter but the group: the counts beside it are of each group.
  const kept = sql`(true
    ${projectId ? sql`and project_id = ${projectId}` : sql``}
    ${supplierId ? sql`and subcontractor_id = ${supplierId}` : sql``}
    ${
      pattern
        ? sql`and (number ilike ${pattern} or supplier_name ilike ${pattern} or order_description ilike ${pattern}
            or ${orderLabelSql(sql`order_number`)} ilike ${pattern} or project_ref ilike ${pattern})`
        : sql``
    })`;
  const soon = addDays(today, DUE_SOON_DAYS);
  const dueSoon = sql`state in ('pending', 'partial') and due_on <= ${soon}::date`;
  const owedCents = (where: SQL) => sql`coalesce(sum(greatest(outstanding, 0)) filter (where ${where}), 0)::bigint`;
  const many = (where: SQL) => sql`(count(*) filter (where ${where}))::int`;

  type Totals = Record<
    "all" | PurchaseInvoiceGroup | "outstanding_invoices" | "outstanding_suppliers" | "overdue_invoices" | "due_soon_invoices" | "outstanding_cents" | "overdue_cents" | "due_soon_cents",
    number
  >;
  type Listed = { totals: Totals | null; page: { id: string; order_id: string }[]; suppliers: { id: string; name: string }[] };
  // One statement: the invoices are settled once (`st`, referenced three times, so the database
  // works it out a single time), and the totals, the page and the suppliers are read off it.
  // The page's order is `byUrgency`'s: owed first, soonest due first; then the settled ones, newest first.
  const [[listed], [month], projectRows] = await Promise.all([
    db.execute<Listed>(sql`
      with st as materialized (${settled}),
      totals as (
        select ${many(kept)} as "all",
          ${many(sql`${kept} and ${INVOICE_GROUP_SQL.open}`)} as open,
          ${many(sql`${kept} and ${INVOICE_GROUP_SQL.overdue}`)} as overdue,
          ${many(sql`${kept} and ${INVOICE_GROUP_SQL.paid}`)} as paid,
          ${many(sql`${kept} and ${INVOICE_GROUP_SQL.credit}`)} as credit,
          ${owedCents(INVOICE_GROUP_SQL.open)} as outstanding_cents,
          ${many(INVOICE_GROUP_SQL.open)} as outstanding_invoices,
          (count(distinct subcontractor_id) filter (where ${INVOICE_GROUP_SQL.open}))::int as outstanding_suppliers,
          ${owedCents(INVOICE_GROUP_SQL.overdue)} as overdue_cents,
          ${many(INVOICE_GROUP_SQL.overdue)} as overdue_invoices,
          ${owedCents(dueSoon)} as due_soon_cents,
          ${many(dueSoon)} as due_soon_invoices
        from st
      ),
      page as (
        select id, order_id, row_number() over (
          order by (state in ${OWED}) desc, case when state in ${OWED} then coalesce(due_on::text, '') end,
            issued_on desc, created_at desc, id desc
        ) as position
        from st
        where ${kept} ${group === "all" ? sql`` : sql`and ${INVOICE_GROUP_SQL[group]}`}
        order by position
        limit ${window.limit} offset ${window.offset}
      )
      select
        (select to_jsonb(totals) from totals) as totals,
        (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'order_id', order_id) order by position), '[]'::jsonb) from page) as page,
        (select coalesce(jsonb_agg(distinct jsonb_build_object('id', subcontractor_id, 'name', supplier_name)), '[]'::jsonb) from st) as suppliers`),
    paymentTotals(ctx.tenantId, invoiceFilter(filters), monthStart(today)),
    projectList(ctx.tenantId),
  ]);
  const totals = listed?.totals;
  const ids = listed?.page ?? [];
  const supplierRows = listed?.suppliers ?? [];
  const built = await buildOrders(ctx.tenantId, ids.map((row) => row.order_id), today);
  const groupCounts = {
    all: totals?.all ?? 0,
    open: totals?.open ?? 0,
    overdue: totals?.overdue ?? 0,
    paid: totals?.paid ?? 0,
    credit: totals?.credit ?? 0,
  };
  return {
    invoices: ids.flatMap((row) => built.items.get(row.id) ?? []),
    paging: pagingOf(window, groupCounts[group]),
    groupCounts,
    suppliers: [...supplierRows].sort((a, b) => a.name.localeCompare(b.name)),
    projects: projectRows,
    summary: {
      outstandingCents: Number(totals?.outstanding_cents ?? 0),
      outstandingInvoices: totals?.outstanding_invoices ?? 0,
      outstandingSuppliers: totals?.outstanding_suppliers ?? 0,
      overdueCents: Number(totals?.overdue_cents ?? 0),
      overdueInvoices: totals?.overdue_invoices ?? 0,
      dueSoonCents: Number(totals?.due_soon_cents ?? 0),
      dueSoonInvoices: totals?.due_soon_invoices ?? 0,
      paidThisMonthCents: month?.monthCents ?? 0,
      paymentsThisMonth: month?.monthPayments ?? 0,
    },
    today,
  };
}

/**
 * What is owed by week of its due date (past due first), and the payments
 * made, newest first: the page `query` asks for, else all of them (up to
 * `MAX_UNPAGED`). Only the invoices that owe something are loaded.
 */
export async function listPayments(ctx: Ctx, filters: Filters = {}, query: PageQuery = {}): Promise<TenantPayments> {
  const today = todayInSpain();
  const window = pageWindow(query);
  const where = invoiceFilter(filters);
  const [owing, payments, [totals]] = await Promise.all([
    db.execute<{ order_id: string }>(sql`
      with st as (${settledInvoices(ctx.tenantId, filters, today)})
      select distinct order_id from st where state in ${OWED} and due_on is not null`),
    loadPayments(ctx.tenantId, where, window),
    paymentTotals(ctx.tenantId, where, monthStart(today)),
  ]);
  const built = await buildOrders(ctx.tenantId, owing.map((row) => row.order_id), today);
  const open = [...built.items.values()].filter((i) => owed(i) && i.outstandingCents > 0 && i.dueOn);
  const forecast = forecastWeeks(today).map((week) => {
    const invoices = open
      .filter((i) => (week.from === null || i.dueOn! >= week.from) && i.dueOn! <= week.to)
      .sort((a, b) => a.dueOn!.localeCompare(b.dueOn!));
    return { ...week, totalCents: sumOwed(invoices), invoices };
  });
  return {
    forecast,
    payments,
    paging: pagingOf(window, totals?.total ?? 0),
    summary: { monthCents: totals?.monthCents ?? 0, monthPayments: totals?.monthPayments ?? 0 },
    today,
  };
}

/**
 * Compras' sections in the rail, and the invoices that need paying now (past
 * due or due soon). The rail asks on every page: one round trip, each count a
 * single pass over its table. Invoices are just counted; only those that could
 * need paying now (an invoice due by the horizon) are settled, set-based as
 * `settledInvoices` does it: its amount to pay, net of its credit notes, less
 * its payments. Deleted invoices and payments, and deleted obras' rows, don't
 * count.
 */
export async function getPurchasingCounts(ctx: Ctx): Promise<PurchasingCounts> {
  const today = todayInSpain();
  const horizon = addDays(today, DUE_SOON_DAYS);
  const tenant = ctx.tenantId;
  const [row] = await db.execute<{ requests: number; orders: number; invoices: number; payments: number; suppliers: number; due: number }>(sql`
    with candidates as (
      select i.id, ${payableOf("i")} as payable
      from ${purchaseInvoices} i
      where i.tenant_id = ${tenant} and i.deleted_at is null and i.kind = 'invoice' and i.due_on <= ${horizon}::date
        and ${inLiveOrder(sql`i.order_id`)}
    ),
    paid as (
      select p.invoice_id, sum(p.amount_cents) as paid from ${purchasePayments} p
      where p.tenant_id = ${tenant} and p.deleted_at is null and p.invoice_id in (select id from candidates) group by p.invoice_id
    ),
    credited as (
      select n.rectifies_id, sum(${payableOf("n")}) as payable from ${purchaseInvoices} n
      where n.tenant_id = ${tenant} and n.kind = 'credit_note' and n.deleted_at is null and n.rectifies_id in (select id from candidates)
      group by n.rectifies_id
    )
    select
      (select count(*) from ${subcontractors} where tenant_id = ${tenant})::int as suppliers,
      (select count(*) from ${purchaseRequests} r join ${projects} rp on rp.id = r.project_id
        where r.tenant_id = ${tenant} and r.status = 'pending' and rp.deleted_at is null)::int as requests,
      (select count(*) from ${purchaseOrders} o join ${projects} op on op.id = o.project_id
        where o.tenant_id = ${tenant} and op.deleted_at is null)::int as orders,
      (select count(*) from ${purchaseInvoices} i
        where i.tenant_id = ${tenant} and i.deleted_at is null and ${inLiveOrder(sql`i.order_id`)})::int as invoices,
      (select count(*) from ${purchasePayments} p join ${purchaseInvoices} i on i.id = p.invoice_id
        where p.tenant_id = ${tenant} and p.deleted_at is null and i.deleted_at is null and ${inLiveOrder(sql`i.order_id`)})::int as payments,
      (select count(*) from candidates c
        left join paid on paid.invoice_id = c.id
        left join credited on credited.rectifies_id = c.id
        where c.payable + coalesce(credited.payable, 0) - coalesce(paid.paid, 0) > 0)::int as due`);
  return {
    requests: row?.requests ?? 0,
    orders: row?.orders ?? 0,
    invoices: row?.invoices ?? 0,
    payments: row?.payments ?? 0,
    suppliers: row?.suppliers ?? 0,
    dueAttention: row?.due ?? 0,
  };
}

/** One invoice (or credit note): its amounts, lines, credit notes, payments, PDF versions and history. */
export async function getInvoice(ctx: Ctx, invoiceId: string): Promise<PurchaseInvoiceDetail> {
  const invoice = await requireInvoice(ctx, invoiceId);
  const [order] = await db
    .select({
      projectId: purchaseOrders.projectId,
      kind: purchaseOrders.kind,
      projectAddress: projects.address,
      supplierKind: subcontractors.kind,
    })
    .from(purchaseOrders)
    .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    // An invoiced order keeps its supplier: the invoice's.
    .innerJoin(subcontractors, eq(subcontractors.id, purchaseOrders.subcontractorId))
    .where(and(eq(purchaseOrders.id, invoice.orderId), projectNotDeleted()));
  if (!order) fail("not_found");
  // A credit note's payments are its invoice's.
  const payer = payerOf(invoice);
  const [loaded, payments, fileRows, events, budget, [creator], checks] = await Promise.all([
    loadInvoices(ctx.tenantId, eq(purchaseInvoices.orderId, invoice.orderId)),
    loadPayments(ctx.tenantId, eq(purchasePayments.invoiceId, payer)),
    db
      .select({ file: purchaseInvoiceFiles, by: userName })
      .from(purchaseInvoiceFiles)
      .leftJoin(users, eq(users.id, purchaseInvoiceFiles.uploadedById))
      .where(and(eq(purchaseInvoiceFiles.invoiceId, invoiceId), eq(purchaseInvoiceFiles.tenantId, ctx.tenantId)))
      .orderBy(desc(purchaseInvoiceFiles.version)),
    db
      .select({ event: purchaseOrderEvents, by: userName })
      .from(purchaseOrderEvents)
      .leftJoin(users, eq(users.id, purchaseOrderEvents.userId))
      .where(
        and(
          eq(purchaseOrderEvents.orderId, invoice.orderId),
          eq(purchaseOrderEvents.tenantId, ctx.tenantId),
          sql`${purchaseOrderEvents.detail}->>'invoiceId' = ${invoiceId}`,
        ),
      )
      .orderBy(desc(purchaseOrderEvents.createdAt))
      .limit(MAX_EVENTS),
    loadBudget(ctx.tenantId, order.projectId),
    invoice.createdById ? db.select({ by: userName }).from(users).where(eq(users.id, invoice.createdById)) : Promise.resolve([]),
    // Its PDFs' reviews, and its payments' proofs'.
    loadChecks(
      ctx.tenantId,
      or(
        inArray(purchaseDocumentChecks.invoiceFileId, db.select({ id: purchaseInvoiceFiles.id }).from(purchaseInvoiceFiles).where(eq(purchaseInvoiceFiles.invoiceId, invoiceId))),
        inArray(purchaseDocumentChecks.paymentId, db.select({ id: purchasePayments.id }).from(purchasePayments).where(and(eq(purchasePayments.invoiceId, payer), isNull(purchasePayments.deletedAt)))),
      )!,
    ),
  ]);
  const today = todayInSpain();
  const built = buildInvoices(loaded, today);
  const item = built.items.get(invoiceId)!;
  const own = loaded.find((l) => l.invoice.id === invoiceId)!;
  const budgetLines = new Map(budget.costChapters.flatMap((c) => c.lines.map((l) => [l.lineageId, l] as const)));
  return {
    ...item,
    notes: invoice.notes,
    projectAddress: order.projectAddress,
    orderKind: order.kind,
    supplierKind: order.supplierKind,
    lines: own.lines
      .map((line) => ({
        lineageId: line.lineageId,
        chapterCode: line.chapterCode,
        code: budgetLines.get(line.lineageId)?.code ?? null,
        description: budgetLines.get(line.lineageId)?.description ?? null,
        amountCents: line.amountCents,
      }))
      .sort((a, b) => (a.code ?? a.chapterCode).localeCompare(b.code ?? b.chapterCode)),
    creditNotes: [...built.items.values()].filter((i) => i.rectifiesId === invoiceId),
    payments,
    checks,
    files: fileRows.map(({ file, by }) => ({
      id: file.id,
      version: file.version,
      filename: file.filename,
      sizeBytes: file.sizeBytes,
      note: file.note,
      by,
      at: file.createdAt.toISOString(),
    })),
    payableLeftCents: built.groups.get(invoiceId)?.settlement.payableLeftCents ?? 0,
    createdBy: creator?.by ?? null,
    events: events.map(({ event, by }) => ({
      id: event.id,
      action: event.action,
      detail: event.detail,
      note: event.note,
      by,
      at: event.createdAt.toISOString(),
    })),
    today,
  };
}

/**
 * What a new invoice picks from: the orders that can be invoiced and, for
 * `orderId` (or the invoice edited), that order's terms, milestones, lines
 * and invoices.
 */
export async function getInvoiceForm(
  ctx: Ctx,
  query: { orderId?: string; invoiceId?: string } = {},
): Promise<PurchaseInvoiceForm> {
  const today = todayInSpain();
  const [editing, all] = await Promise.all([
    query.invoiceId ? getInvoice(ctx, query.invoiceId) : null,
    loadOrders(ctx.tenantId),
  ]);
  const orderId = editing?.orderId ?? query.orderId;
  const amountOf = (lines: { amountCents: number }[]) => lines.reduce((sum, l) => sum + l.amountCents, 0);
  const orders = all
    .filter((o) => countsAsContracted(o.order.status))
    .map((o) => ({
      id: o.order.id,
      number: o.order.number,
      projectId: o.order.projectId,
      projectRef: o.projectRef,
      description: o.order.description,
      subcontractorId: o.order.subcontractorId,
      supplierName: o.supplierName,
      amountCents: amountOf(o.lines),
      invoicedCents: o.invoicedCents,
    }));
  if (!orderId) return { orders, order: null, editing, today };

  const order = all.find((o) => o.order.id === orderId);
  if (!order) fail("not_found");
  const [loaded, milestones, budget, [supplier]] = await Promise.all([
    loadInvoices(ctx.tenantId, eq(purchaseInvoices.orderId, orderId)),
    loadMilestones(ctx.tenantId, eq(purchaseOrders.id, orderId)),
    contractLines(ctx.tenantId, order.order.projectId),
    db.select({ kind: subcontractors.kind }).from(subcontractors).where(eq(subcontractors.id, order.order.subcontractorId)),
  ]);
  const built = buildInvoices(loaded, today);
  const byLine = invoicingByLine(built);
  const amountCents = amountOf(order.lines);
  return {
    orders,
    order: {
      id: orderId,
      kind: order.order.kind,
      supplierKind: supplier?.kind ?? "company",
      amountCents,
      terms: termsOf(order.order),
      milestones: orderMilestones(milestones.get(orderId) ?? [], built),
      lines: order.lines
        .map((line) => ({
          lineageId: line.lineageId,
          chapterCode: line.chapterCode,
          code: budget.get(line.lineageId)?.code ?? null,
          description: budget.get(line.lineageId)?.description ?? null,
          amountCents: line.amountCents,
          invoicedCents: byLine.get(line.lineageId)?.invoicedCents ?? 0,
        }))
        .sort((a, b) => (a.code ?? a.chapterCode).localeCompare(b.code ?? b.chapterCode)),
      invoices: itemsOfOrder(built, orderId),
      invoicing: orderInvoicing(amountCents, groupsOfOrder(built, orderId)),
    },
    editing,
    today,
  };
}

/** The invoice's PDF: `fileId`'s version, else the current one. Every staff member may read it. */
export async function openInvoiceFile(ctx: Ctx, invoiceId: string, fileId?: string): Promise<StoredFile> {
  await requireInvoice(ctx, invoiceId);
  const [file] = await db
    .select()
    .from(purchaseInvoiceFiles)
    .where(
      and(
        eq(purchaseInvoiceFiles.invoiceId, invoiceId),
        eq(purchaseInvoiceFiles.tenantId, ctx.tenantId),
        fileId ? eq(purchaseInvoiceFiles.id, fileId) : undefined,
      ),
    )
    .orderBy(desc(purchaseInvoiceFiles.version))
    .limit(1);
  if (!file) fail("not_found");
  return openStoredFile({
    filename: file.filename,
    contentType: "application/pdf",
    sizeBytes: file.sizeBytes,
    pathname: file.pathname,
  });
}

/** A payment's proof, for download. */
export async function openPaymentFile(ctx: Ctx, paymentId: string): Promise<StoredFile> {
  const payment = await requirePayment(ctx, paymentId);
  if (!payment.filePathname) fail("not_found");
  return openStoredFile({
    filename: payment.fileName ?? "justificante.pdf",
    contentType: "application/pdf",
    sizeBytes: payment.fileSizeBytes ?? 0,
    pathname: payment.filePathname,
  });
}

// ─── Writes: invoices ────────────────────────────────────────────────────────

/** An optional PDF in `input.file`: absent (or empty) is none. */
const optionalPdf = (value: unknown) =>
  value === undefined || value === null || value === "" ? Promise.resolve(null) : requirePdf(value);

const invoiceFolder = (ctx: Ctx, projectId: string, orderId: string, invoiceId: string) =>
  `${projectFolder(ctx.tenantId, projectId)}purchases/${orderId}/invoices/${invoiceId}/`;

/** The order's lines (its contract), to split an invoice across. */
const orderLines = (tenantId: string, orderId: string) =>
  db
    .select({ lineageId: purchaseOrderLines.lineageId, chapterCode: purchaseOrderLines.chapterCode, amountCents: purchaseOrderLines.amountCents })
    .from(purchaseOrderLines)
    .where(and(eq(purchaseOrderLines.tenantId, tenantId), eq(purchaseOrderLines.orderId, orderId)));

/**
 * How `baseCents` splits across the order's lines: as given (each an order
 * line once, adding up to the base, of its sign), else in proportion to
 * `weights` (the order's lines, or the rectified invoice's).
 */
function splitLines(
  value: unknown,
  baseCents: number,
  lines: NewInvoiceLine[],
  weights: { lineageId: string; amountCents: number }[],
): NewInvoiceLine[] {
  const byLineage = new Map(lines.map((l) => [l.lineageId, l]));
  if (value === undefined || value === null) {
    const shares = weights.filter((w) => byLineage.has(w.lineageId));
    const parts = splitProportional(
      baseCents,
      shares.map((w) => Math.abs(w.amountCents)),
    );
    return shares
      .map((w, i) => ({ lineageId: w.lineageId, chapterCode: byLineage.get(w.lineageId)!.chapterCode, amountCents: parts[i]! }))
      .filter((l) => l.amountCents !== 0);
  }
  if (!Array.isArray(value) || value.length === 0) fail("invalid_input");
  const seen = new Set<string>();
  const parsed = value.map((entry) => {
    if (!isObject(entry) || typeof entry.lineageId !== "string") fail("invalid_input");
    const line = byLineage.get(entry.lineageId);
    if (!line) fail("unknown_line");
    if (seen.has(entry.lineageId)) fail("invalid_input");
    seen.add(entry.lineageId);
    const amountCents = integer(entry.amountCents, -MAX_AMOUNT_CENTS, MAX_AMOUNT_CENTS);
    if (amountCents === 0 || Math.sign(amountCents) !== Math.sign(baseCents)) fail("invalid_input");
    return { lineageId: line.lineageId, chapterCode: line.chapterCode, amountCents };
  });
  if (parsed.reduce((sum, l) => sum + l.amountCents, 0) !== baseCents) fail("invalid_input");
  return parsed;
}

const basePoints = (max: number) => (value: unknown) => integer(value, 0, max);

/** An invoice's base: positive; a credit note's, negative. */
const baseOf = (kind: PurchaseInvoiceKind) => (value: unknown) =>
  kind === "invoice" ? integer(value, 1, MAX_AMOUNT_CENTS) : integer(value, -MAX_AMOUNT_CENTS, -1);

/** The order locked for this transaction, still placed: invoices only go to a contracted order. */
async function lockPlacedOrder(tx: Tx, orderId: string) {
  const [locked] = await tx
    .select({ status: purchaseOrders.status, subcontractorId: purchaseOrders.subcontractorId })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, orderId))
    .for("update");
  if (!locked || !countsAsContracted(locked.status)) fail("invalid_state");
  return locked;
}

/**
 * Body: { kind? (invoice | credit_note), number, issuedOn, dueOn? (else the
 * order's days to pay), milestoneId? (required when the order has a
 * schedule), rectifiesId? (a credit note's invoice, of the same order),
 * baseCents (negative for a credit note), vatKind?, irpfBp?, retentionBp?
 * (else the order's, or the rectified invoice's), lines? ([{ lineageId,
 * amountCents }], else in proportion), notes?, file? (PDF), idempotencyKey?
 * (sent again with the same key, it is registered once: ./idempotency) }.
 * Only a placed order takes invoices. → { invoiceId }
 */
export async function createInvoice(ctx: Ctx, orderId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  return idempotent<{ invoiceId: string }>(ctx, "purchase.invoice.create", { orderId }, input, (once) => registerInvoice(ctx, orderId, input, once));
}

async function registerInvoice(ctx: Ctx, orderId: string, input: Record<string, unknown>, once: Once<{ invoiceId: string }>) {
  const order = await requireOrder(ctx, orderId);
  if (!countsAsContracted(order.status)) fail("invalid_state");
  const kind = input.kind === undefined ? "invoice" : pick(PURCHASE_INVOICE_KINDS)(input.kind);
  const terms = termsOf(order);
  const [lines, milestones] = await Promise.all([
    orderLines(ctx.tenantId, orderId),
    loadMilestones(ctx.tenantId, eq(purchaseOrders.id, orderId)),
  ]);
  const schedule = milestones.get(orderId) ?? [];

  let rectified: InvoiceRow | null = null;
  let milestoneId: string | null = null;
  if (kind === "credit_note") {
    if (typeof input.rectifiesId !== "string") fail("missing_fields");
    rectified = await requireInvoice(ctx, input.rectifiesId);
    if (rectified.orderId !== orderId || rectified.kind !== "invoice") fail("invalid_input");
  } else if (input.milestoneId !== undefined && input.milestoneId !== null) {
    milestoneId = schedule.find((m) => m.id === input.milestoneId)?.id ?? fail("invalid_input");
  } else if (schedule.length > 0) {
    fail("missing_fields");
  }

  const issuedOn = workDate(input.issuedOn);
  const dueOn = kind === "credit_note" ? null : (orNull(calendarDate)(input.dueOn) ?? defaultDueOn(issuedOn, terms.paymentDays));
  if (dueOn && dueOn < issuedOn) fail("invalid_date");
  const amounts = invoiceAmounts({
    baseCents: baseOf(kind)(input.baseCents),
    vatKind: input.vatKind === undefined ? (rectified?.vatKind ?? terms.vatKind) : pick(PURCHASE_VAT_KINDS)(input.vatKind),
    irpfBp: input.irpfBp === undefined ? (rectified?.irpfBp ?? 0) : basePoints(MAX_IRPF_BP)(input.irpfBp),
    retentionBp:
      input.retentionBp === undefined ? (rectified?.retentionBp ?? terms.retentionBp) : basePoints(MAX_RETENTION_BP)(input.retentionBp),
  });
  const weights = rectified ? await rectifiedLines(ctx, rectified.id) : lines;
  const split = splitLines(input.lines, amounts.baseCents, lines, weights);
  const number = requiredText(input.number, MAX_NUMBER);
  const notes = optionalText(input.notes, MAX_NOTES);
  const file = await optionalPdf(input.file);

  const invoiceId = crypto.randomUUID();
  const folder = invoiceFolder(ctx, order.projectId, orderId, invoiceId);
  const pathname = `${folder}${crypto.randomUUID()}.pdf`;
  // No file: storeFiles just records it.
  await storeFiles(file ? [{ pathname, body: file, contentType: "application/pdf" }] : [], () =>
    db.transaction((tx) =>
      once(tx, async () => {
        const locked = await lockPlacedOrder(tx, orderId);
        if (rectified) await checkCreditRoom(tx, rectified.id, amounts.baseCents);
        await checkOnOrder(tx, orderId, split, milestoneId);
        const [row] = await tx
          .insert(purchaseInvoices)
          .values({
            id: invoiceId,
            tenantId: ctx.tenantId,
            orderId,
            subcontractorId: locked.subcontractorId,
            kind,
            number,
            milestoneId,
            rectifiesId: rectified?.id ?? null,
            issuedOn,
            dueOn,
            baseCents: amounts.baseCents,
            vatKind: amounts.vatKind,
            vatCents: amounts.vatCents,
            irpfBp: amounts.irpfBp,
            irpfCents: amounts.irpfCents,
            retentionBp: amounts.retentionBp,
            retentionCents: amounts.retentionCents,
            notes,
            createdById: ctx.userId,
          })
          .onConflictDoNothing()
          .returning({ id: purchaseInvoices.id });
        if (!row) fail("duplicate_number");
        await tx.insert(purchaseInvoiceLines).values(split.map((l) => ({ ...l, tenantId: ctx.tenantId, invoiceId })));
        if (file) {
          await tx.insert(purchaseInvoiceFiles).values({
            tenantId: ctx.tenantId,
            invoiceId,
            version: 1,
            pathname,
            filename: uploadedName(file, `${number}.pdf`),
            sizeBytes: file.size,
            uploadedById: ctx.userId,
          });
        }
        await logEvent(tx, ctx, orderId, "invoice_created", {
          invoiceId,
          number,
          kind,
          baseCents: amounts.baseCents,
          milestoneId,
          rectifiesId: rectified?.id ?? null,
        });
        return { invoiceId };
      }),
    ),
  );
  return { invoiceId };
}

/**
 * In `tx`, the order locked, so an edit of its lines or schedule can't slip in
 * between: `lines` are still lines of the order, and `milestoneId` still one
 * of its schedule.
 */
async function checkOnOrder(tx: Tx, orderId: string, lines: { lineageId: string }[], milestoneId: string | null) {
  const [current, schedule] = await Promise.all([
    tx.select({ lineageId: purchaseOrderLines.lineageId }).from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, orderId)),
    milestoneId
      ? tx.select({ id: purchaseOrderMilestones.id }).from(purchaseOrderMilestones).where(eq(purchaseOrderMilestones.id, milestoneId))
      : [],
  ]);
  const contracted = new Set(current.map((l) => l.lineageId));
  if (lines.some((l) => !contracted.has(l.lineageId))) fail("unknown_line");
  if (milestoneId && schedule.length === 0) fail("invalid_input");
}

/**
 * In `tx`, for a deleted invoice (or credit note) about to come back
 * (./deleted): what `createInvoice` holds a new one to, as the order stands
 * now. Its order is still placed and still its supplier's (`invalid_state`),
 * its lines are still the order's (`unknown_line`), an order that has a
 * payment schedule since has it on a milestone (`missing_fields`), and a
 * credit note still fits in what its invoice leaves (`exceeds_amount`).
 */
export async function checkInvoiceRestorable(tx: Tx, invoice: InvoiceRow) {
  const locked = await lockPlacedOrder(tx, invoice.orderId);
  if (locked.subcontractorId !== invoice.subcontractorId) fail("invalid_state");
  const lines = await tx
    .select({ lineageId: purchaseInvoiceLines.lineageId })
    .from(purchaseInvoiceLines)
    .where(eq(purchaseInvoiceLines.invoiceId, invoice.id));
  await checkOnOrder(tx, invoice.orderId, lines, invoice.milestoneId);
  if (invoice.kind === "credit_note") return checkCreditRoom(tx, invoice.rectifiesId!, invoice.baseCents);
  if (invoice.milestoneId) return;
  // Its milestone went with the schedule it was deleted under (`releaseMilestones`).
  const [scheduled] = await tx
    .select({ id: purchaseOrderMilestones.id })
    .from(purchaseOrderMilestones)
    .where(eq(purchaseOrderMilestones.orderId, invoice.orderId))
    .limit(1);
  if (scheduled) fail("missing_fields");
}

/** Locks the invoice for this transaction; `not_found` if it was deleted meanwhile. */
async function lockInvoice(tx: Tx, invoiceId: string) {
  const [locked] = await tx
    .select({ id: purchaseInvoices.id })
    .from(purchaseInvoices)
    .where(and(eq(purchaseInvoices.id, invoiceId), isNull(purchaseInvoices.deletedAt)))
    .for("update");
  if (!locked) fail("not_found");
}

/** An invoice and its credit notes. */
const inGroup = (invoiceId: string) => sql`(${purchaseInvoices.id} = ${invoiceId} or ${purchaseInvoices.rectifiesId} = ${invoiceId})`;

/** A credit note never takes off more than its invoice and the invoice's other credit notes (deleted ones aside) leave. */
async function checkCreditRoom(tx: Tx, invoiceId: string, addedCents: number) {
  // Locked: two credit notes at once can't both fit in what is left.
  await lockInvoice(tx, invoiceId);
  const [left] = await tx
    .select({ base: sql<string>`sum(${purchaseInvoices.baseCents})` })
    .from(purchaseInvoices)
    .where(and(inGroup(invoiceId), isNull(purchaseInvoices.deletedAt)));
  if (Number(left?.base ?? 0) + addedCents < 0) fail("exceeds_amount");
}

/** The lines of the invoice a credit note rectifies: its split is the credit note's. */
const rectifiedLines = (ctx: Ctx, invoiceId: string) =>
  db
    .select({ lineageId: purchaseInvoiceLines.lineageId, amountCents: purchaseInvoiceLines.amountCents })
    .from(purchaseInvoiceLines)
    .where(and(eq(purchaseInvoiceLines.invoiceId, invoiceId), eq(purchaseInvoiceLines.tenantId, ctx.tenantId)));

/** What was paid on the invoice an invoice or credit note settles against (deleted payments aside). */
async function paidAgainst(run: Tx | typeof db, invoice: InvoiceRow) {
  const [row] = await run
    .select({ paid: sql<string>`coalesce(sum(${purchasePayments.amountCents}), 0)` })
    .from(purchasePayments)
    .where(and(eq(purchasePayments.invoiceId, payerOf(invoice)), isNull(purchasePayments.deletedAt)));
  return Number(row?.paid ?? 0);
}

/**
 * Body: any of { number, issuedOn, dueOn, notes }, and, until something is
 * paid on it, any of { baseCents, vatKind, irpfBp, retentionBp, milestoneId,
 * lines }. A changed base keeps the split's proportions unless `lines` say
 * otherwise. Each change is logged with its previous value. → { invoiceId }
 */
export async function updateInvoice(ctx: Ctx, invoiceId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const invoice = await requireInvoice(ctx, invoiceId);
  const parsed = pickChanges<Pick<InvoiceRow, "number" | "issuedOn" | "dueOn" | "notes" | "baseCents" | "vatKind" | "irpfBp" | "retentionBp" | "milestoneId">>(
    input,
    {
      number: (value) => requiredText(value, MAX_NUMBER),
      issuedOn: (value) => workDate(value),
      dueOn: invoice.kind === "invoice" ? (value) => calendarDate(value) : () => fail("invalid_input"),
      notes: (value) => optionalText(value, MAX_NOTES),
      baseCents: baseOf(invoice.kind),
      vatKind: pick(PURCHASE_VAT_KINDS),
      irpfBp: basePoints(MAX_IRPF_BP),
      retentionBp: basePoints(MAX_RETENTION_BP),
      milestoneId: invoice.kind === "invoice" ? (value) => (typeof value === "string" ? value : fail("invalid_input")) : () => fail("invalid_input"),
    },
  );
  const money = (["baseCents", "vatKind", "irpfBp", "retentionBp", "milestoneId"] as const).some((k) => k in parsed) || "lines" in input;
  const next = { ...invoice, ...parsed };
  if (next.dueOn && next.dueOn < next.issuedOn) fail("invalid_date");
  const amounts = invoiceAmounts(next);
  const [lines, current, milestones] = await Promise.all([
    orderLines(ctx.tenantId, invoice.orderId),
    db.select().from(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.invoiceId, invoiceId)),
    parsed.milestoneId ? loadMilestones(ctx.tenantId, eq(purchaseOrders.id, invoice.orderId)) : null,
  ]);
  if (milestones && !milestones.get(invoice.orderId)?.some((m) => m.id === parsed.milestoneId)) fail("invalid_input");
  const split =
    "lines" in input || amounts.baseCents !== invoice.baseCents
      ? splitLines("lines" in input ? input.lines : undefined, amounts.baseCents, lines, current)
      : null;
  const changed = Object.fromEntries(
    (Object.keys(parsed) as (keyof typeof parsed)[])
      .filter((key) => parsed[key] !== invoice[key])
      .map((key) => [key, { from: invoice[key], to: parsed[key] }]),
  );

  try {
    await db.transaction(async (tx) => {
      await lockInvoice(tx, invoiceId);
      if (money && (await paidAgainst(tx, invoice)) > 0) fail("has_payments");
      // Never below what its credit notes take off (an invoice), nor more off than its invoice leaves (a credit note).
      if (amounts.baseCents !== invoice.baseCents) {
        await checkCreditRoom(tx, invoice.rectifiesId ?? invoice.id, amounts.baseCents - invoice.baseCents);
      }
      // A payment is never dated before its invoice.
      if (parsed.issuedOn && parsed.issuedOn > invoice.issuedOn && invoice.kind === "invoice") {
        const [first] = await tx
          .select({ paidOn: sql<string | null>`min(${purchasePayments.paidOn})` })
          .from(purchasePayments)
          .where(and(eq(purchasePayments.invoiceId, invoiceId), isNull(purchasePayments.deletedAt)));
        if (first?.paidOn && first.paidOn < parsed.issuedOn) fail("invalid_date");
      }
      if (Object.keys(changed).length === 0 && !split) return;
      await tx
        .update(purchaseInvoices)
        .set({ ...parsed, vatCents: amounts.vatCents, irpfCents: amounts.irpfCents, retentionCents: amounts.retentionCents })
        .where(eq(purchaseInvoices.id, invoiceId));
      if (split) {
        await tx.delete(purchaseInvoiceLines).where(eq(purchaseInvoiceLines.invoiceId, invoiceId));
        await tx.insert(purchaseInvoiceLines).values(split.map((l) => ({ ...l, tenantId: ctx.tenantId, invoiceId })));
      }
      await logEvent(tx, ctx, invoice.orderId, "invoice_updated", {
        invoiceId,
        number: next.number,
        fields: changed,
        ...(split ? { lines: split.length } : {}),
      });
    });
  } catch (error) {
    if (isUniqueViolation(error, "purchase_invoices_supplier_number_unique")) fail("duplicate_number");
    throw error;
  }
  return { invoiceId };
}

/**
 * Deletes an invoice nothing was paid on and no credit note rectifies: it
 * leaves every list and total, its row and PDFs stay (a soft delete), and
 * its number is free again. Deleted already: `not_found`.
 */
export async function deleteInvoice(ctx: Ctx, invoiceId: string) {
  requireEditor(ctx);
  const invoice = await requireInvoice(ctx, invoiceId);
  await db.transaction(async (tx) => {
    // Under the lock: a payment or credit note can't land between the check and the delete.
    await lockInvoice(tx, invoiceId);
    if (invoice.kind === "invoice" && (await paidAgainst(tx, invoice)) > 0) fail("has_payments");
    const [credit] = await tx
      .select({ id: purchaseInvoices.id })
      .from(purchaseInvoices)
      .where(and(eq(purchaseInvoices.rectifiesId, invoiceId), isNull(purchaseInvoices.deletedAt)))
      .limit(1);
    if (credit) fail("has_invoices");
    await tx.update(purchaseInvoices).set(softDeleted(ctx)).where(eq(purchaseInvoices.id, invoiceId));
    await logEvent(tx, ctx, invoice.orderId, "invoice_deleted", { invoiceId, number: invoice.number, kind: invoice.kind });
  });
  return { invoiceId };
}

/** Body: { file (PDF), note? (why it replaces the last one) }: the invoice's next version; none is ever deleted. */
export async function addInvoiceFile(ctx: Ctx, invoiceId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const invoice = await requireInvoice(ctx, invoiceId);
  const file = await requirePdf(input.file);
  const note = optionalText(input.note, MAX_FILE_NOTE);
  const [order] = await db.select({ projectId: purchaseOrders.projectId }).from(purchaseOrders).where(eq(purchaseOrders.id, invoice.orderId));
  const pathname = `${invoiceFolder(ctx, order!.projectId, invoice.orderId, invoiceId)}${crypto.randomUUID()}.pdf`;
  const filename = uploadedName(file, `${invoice.number}.pdf`);
  let version = 0;
  await storeFiles([{ pathname, body: file, contentType: "application/pdf" }], async () => {
    // Two uploads at once may take the same version: the later one tries the next.
    for (let attempt = 0; attempt < 5 && version === 0; attempt++) {
      version = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(purchaseInvoiceFiles)
          .values({
            tenantId: ctx.tenantId,
            invoiceId,
            version: sql`(select coalesce(max(${purchaseInvoiceFiles.version}), 0) + 1 from ${purchaseInvoiceFiles} where ${purchaseInvoiceFiles.invoiceId} = ${invoiceId})`,
            pathname,
            filename,
            sizeBytes: file.size,
            note,
            uploadedById: ctx.userId,
          })
          .onConflictDoNothing()
          .returning({ version: purchaseInvoiceFiles.version });
        if (!row) return 0;
        await logEvent(tx, ctx, invoice.orderId, "invoice_file_added", { invoiceId, number: invoice.number, version: row.version, name: filename }, note);
        return row.version;
      });
    }
    if (version === 0) throw new Error("Could not version the invoice's file");
  });
  return { invoiceId, version };
}

// ─── Writes: payments ────────────────────────────────────────────────────────

/** The tenant's payment, not deleted, of an invoice and an obra not deleted; `not_found` otherwise. */
async function requirePayment(ctx: Ctx, paymentId: string) {
  const [row] = await db
    .select({ payment: purchasePayments })
    .from(purchasePayments)
    .innerJoin(purchaseInvoices, eq(purchaseInvoices.id, purchasePayments.invoiceId))
    .innerJoin(purchaseOrders, eq(purchaseOrders.id, purchaseInvoices.orderId))
    .innerJoin(projects, eq(projects.id, purchaseOrders.projectId))
    .where(
      and(
        eq(purchasePayments.id, paymentId),
        eq(purchasePayments.tenantId, ctx.tenantId),
        isNull(purchasePayments.deletedAt),
        isNull(purchaseInvoices.deletedAt),
        projectNotDeleted(),
      ),
    );
  if (!row) fail("not_found");
  return row.payment;
}

/**
 * In `tx`: `amountCents` more fits in what the invoice can still be paid (its
 * total, its credit notes off, less what was paid); `exceeds_amount` otherwise.
 */
async function checkPayable(tx: Tx, invoice: InvoiceRow, amountCents: number) {
  // Locked: two payments at once can't both fit in what is left.
  await lockInvoice(tx, invoice.id);
  const group = await tx.select().from(purchaseInvoices).where(and(inGroup(invoice.id), isNull(purchaseInvoices.deletedAt)));
  const own = group.find((g) => g.id === invoice.id)!;
  const settlement = settle(
    withTotals(own),
    group.filter((g) => g.id !== invoice.id).map(withTotals),
    await paidAgainst(tx, invoice),
  );
  if (amountCents > settlement.payableLeftCents) fail("exceeds_amount");
}

/**
 * In `tx`, for a deleted payment about to come back (./deleted): what
 * `createPayment` holds a new one to, as its invoice stands now. Never dated
 * before the invoice (`invalid_date`), never more than is left to pay
 * (`exceeds_amount`).
 */
export async function checkPaymentRestorable(tx: Tx, invoice: InvoiceRow, payment: { paidOn: string; amountCents: number }) {
  if (invoice.kind !== "invoice") fail("invalid_state");
  if (payment.paidOn < invoice.issuedOn) fail("invalid_date");
  await checkPayable(tx, invoice, payment.amountCents);
}

/**
 * Body: { amountCents, paidOn? (today by default; not before the invoice nor
 * after today), method? (transfer by default), reference?, file? (PDF proof) }.
 * Partial payments add up; past what is due, the retention is being
 * released; never more than the invoice's total, its credit notes off.
 * With an `idempotencyKey`, the same payment sent again (a double click, a
 * retry after a timeout) is recorded once and answered the same
 * (./idempotency). → { paymentId }
 */
export async function createPayment(ctx: Ctx, invoiceId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  return idempotent<{ paymentId: string }>(ctx, "purchase.payment.create", { invoiceId }, input, (once) => recordPayment(ctx, invoiceId, input, once));
}

async function recordPayment(ctx: Ctx, invoiceId: string, input: Record<string, unknown>, once: Once<{ paymentId: string }>) {
  const invoice = await requireInvoice(ctx, invoiceId);
  // A credit note is settled through its invoice.
  if (invoice.kind !== "invoice") fail("invalid_state");
  const paidOn = input.paidOn === undefined ? todayInSpain() : workDate(input.paidOn);
  if (paidOn < invoice.issuedOn) fail("invalid_date");
  const amountCents = integer(input.amountCents, 1, MAX_AMOUNT_CENTS);
  const method = input.method === undefined ? "transfer" : pick(PURCHASE_PAYMENT_METHODS)(input.method);
  const reference = optionalText(input.reference, MAX_REFERENCE);
  const file = await optionalPdf(input.file);
  const [order] = await db.select({ projectId: purchaseOrders.projectId }).from(purchaseOrders).where(eq(purchaseOrders.id, invoice.orderId));
  const paymentId = crypto.randomUUID();
  const pathname = `${projectFolder(ctx.tenantId, order!.projectId)}purchases/${invoice.orderId}/payments/${paymentId}.pdf`;
  await storeFiles(file ? [{ pathname, body: file, contentType: "application/pdf" }] : [], () =>
    db.transaction((tx) =>
      once(tx, async () => {
        await checkPayable(tx, invoice, amountCents);
        await tx.insert(purchasePayments).values({
          id: paymentId,
          tenantId: ctx.tenantId,
          invoiceId,
          paidOn: paidOn,
          amountCents,
          method,
          reference,
          ...(file ? { fileName: uploadedName(file, "justificante.pdf"), filePathname: pathname, fileSizeBytes: file.size } : {}),
          createdById: ctx.userId,
        });
        await logEvent(tx, ctx, invoice.orderId, "payment_added", {
          invoiceId,
          number: invoice.number,
          paymentId,
          amountCents,
          paidOn: paidOn,
          method,
        });
        return { paymentId };
      }),
    ),
  );
  return { paymentId };
}

/**
 * Deletes a payment recorded by mistake: the invoice owes it again, its row
 * and proof stay (a soft delete). Deleted already: `not_found`.
 */
export async function deletePayment(ctx: Ctx, paymentId: string) {
  requireEditor(ctx);
  const payment = await requirePayment(ctx, paymentId);
  const invoice = await requireInvoice(ctx, payment.invoiceId);
  await db.transaction(async (tx) => {
    const [deleted] = await tx
      .update(purchasePayments)
      .set(softDeleted(ctx))
      .where(and(eq(purchasePayments.id, paymentId), isNull(purchasePayments.deletedAt)))
      .returning({ id: purchasePayments.id });
    if (!deleted) fail("not_found");
    await logEvent(tx, ctx, invoice.orderId, "payment_deleted", {
      invoiceId: invoice.id,
      number: invoice.number,
      paymentId,
      amountCents: payment.amountCents,
      paidOn: payment.paidOn,
    });
  });
  return { paymentId };
}

// ─── Writes: an order's payment schedule ─────────────────────────────────────

/**
 * Body: { milestones: [{ id? (to keep one), concept, amountCents }] } in
 * turn, adding up to the order's amount; [] drops the schedule. A milestone
 * with invoices stays, with its amount. → { orderId }
 */
export async function setOrderMilestones(ctx: Ctx, orderId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const order = await requireOrder(ctx, orderId);
  if (order.status === "cancelled") fail("invalid_state");
  const value = input.milestones;
  if (!Array.isArray(value)) fail("missing_fields");
  if (value.length > MAX_MILESTONES) fail("invalid_input");
  const wanted = value.map((entry) => {
    if (!isObject(entry)) fail("invalid_input");
    if (entry.id !== undefined && typeof entry.id !== "string") fail("invalid_input");
    return {
      id: entry.id as string | undefined,
      concept: requiredText(entry.concept, MAX_CONCEPT),
      amountCents: integer(entry.amountCents, 1, MAX_AMOUNT_CENTS),
    };
  });
  if (new Set(wanted.flatMap((m) => (m.id ? [m.id] : []))).size !== wanted.filter((m) => m.id).length) fail("invalid_input");

  await db.transaction(async (tx) => {
    await tx.select({ id: purchaseOrders.id }).from(purchaseOrders).where(eq(purchaseOrders.id, orderId)).for("update");
    const [lines, existing, invoiced] = await Promise.all([
      tx.select({ amountCents: purchaseOrderLines.amountCents }).from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, orderId)),
      tx.select().from(purchaseOrderMilestones).where(eq(purchaseOrderMilestones.orderId, orderId)).orderBy(asc(purchaseOrderMilestones.position)),
      tx
        .selectDistinct({ milestoneId: purchaseInvoices.milestoneId })
        .from(purchaseInvoices)
        // A deleted invoice locks no milestone.
        .where(and(eq(purchaseInvoices.orderId, orderId), isNull(purchaseInvoices.deletedAt))),
    ]);
    const amount = lines.reduce((sum, l) => sum + l.amountCents, 0);
    if (wanted.length > 0 && wanted.reduce((sum, m) => sum + m.amountCents, 0) !== amount) fail("milestones_mismatch");
    const byId = new Map(existing.map((m) => [m.id, m]));
    if (wanted.some((m) => m.id && !byId.has(m.id))) fail("invalid_input");
    // An invoiced milestone keeps its place in the schedule and its amount.
    const locked = new Set(invoiced.flatMap((i) => (i.milestoneId ? [i.milestoneId] : [])));
    for (const id of locked) {
      const kept = wanted.find((m) => m.id === id);
      if (!kept || kept.amountCents !== byId.get(id)!.amountCents) fail("has_invoices");
    }
    const keep = new Set(wanted.flatMap((m) => (m.id ? [m.id] : [])));
    const dropped = existing.filter((m) => !keep.has(m.id)).map((m) => m.id);
    if (dropped.length > 0) {
      await releaseMilestones(tx, dropped);
      await tx.delete(purchaseOrderMilestones).where(inArray(purchaseOrderMilestones.id, dropped));
    }
    for (const [position, m] of wanted.entries()) {
      if (m.id) {
        await tx
          .update(purchaseOrderMilestones)
          .set({ position, concept: m.concept, amountCents: m.amountCents })
          .where(eq(purchaseOrderMilestones.id, m.id));
      } else {
        await tx.insert(purchaseOrderMilestones).values({ tenantId: ctx.tenantId, orderId, position, concept: m.concept, amountCents: m.amountCents });
      }
    }
    const shape = (list: { concept: string; amountCents: number }[]) => list.map(({ concept, amountCents }) => ({ concept, amountCents }));
    await logEvent(tx, ctx, orderId, "milestones", { from: shape(existing), to: shape(wanted) });
  });
  return { orderId };
}
