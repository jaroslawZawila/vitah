import {
  and,
  asc,
  db,
  desc,
  eq,
  gte,
  inArray,
  projects,
  purchaseInvoiceFiles,
  purchaseInvoiceLines,
  purchaseInvoices,
  purchaseOrderEvents,
  purchaseOrderLines,
  purchaseOrderMilestones,
  purchaseOrders,
  purchasePayments,
  sql,
  subcontractors,
  users,
  type SQL,
} from "@repo/db";
import { isUniqueViolation } from "./accounts";
import { requireEditor, type Ctx } from "./context";
import {
  DUE_SOON_DAYS,
  MAX_IRPF_BP,
  MAX_MILESTONES,
  MAX_RETENTION_BP,
  PURCHASE_INVOICE_KINDS,
  PURCHASE_PAYMENT_METHODS,
  PURCHASE_VAT_KINDS,
  countsAsContracted,
  type PurchaseInvoiceDetail,
  type PurchaseInvoiceForm,
  type PurchaseInvoiceKind,
  type PurchaseInvoiceListItem,
  type PurchasingCounts,
  type TenantInvoices,
  type TenantPayments,
} from "./contract";
import { requirePdf } from "./documents";
import { addDays, todayInSpain } from "./obra-calc";
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
import type { Tx } from "./project-client";
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
} from "./purchase-invoice-data";
import { contractLines, loadOrders, logEvent, projectList, requireOrder } from "./purchasing";
import { deleteFile } from "./storage";

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

/** The tenant's invoice (or credit note); `not_found` otherwise. */
async function requireInvoice(ctx: Ctx, invoiceId: string) {
  const invoice = await db.query.purchaseInvoices.findFirst({
    where: and(eq(purchaseInvoices.id, invoiceId), eq(purchaseInvoices.tenantId, ctx.tenantId)),
  });
  if (!invoice) fail("not_found");
  return invoice;
}

const owed = (i: PurchaseInvoiceListItem) => isOwed(i.state);
const sumOwed = (list: PurchaseInvoiceListItem[]) => list.reduce((sum, i) => sum + Math.max(0, i.outstandingCents), 0);

/** The invoice whose payments settle `invoice`: its own, or a credit note's invoice. */
const payerOf = (invoice: InvoiceRow) => (invoice.kind === "invoice" ? invoice.id : invoice.rectifiesId!);

/** Owed first, soonest due first; then the settled ones, newest first. */
function byUrgency(a: PurchaseInvoiceListItem, b: PurchaseInvoiceListItem) {
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

// ─── Reads ───────────────────────────────────────────────────────────────────

/** Administration's invoices: every supplier invoice of the tenant (or of a project or supplier), with what is owed. */
export async function listInvoices(ctx: Ctx, filters: Filters = {}): Promise<TenantInvoices> {
  const today = todayInSpain();
  const where = invoiceFilter(filters);
  const [loaded, month, projectRows] = await Promise.all([
    loadInvoices(ctx.tenantId, where, { lines: false }),
    loadPayments(ctx.tenantId, and(where, gte(purchasePayments.paidOn, monthStart(today)))),
    projectList(ctx.tenantId),
  ]);
  const invoices = [...buildInvoices(loaded, today).items.values()].sort(byUrgency);
  const open = invoices.filter(owed);
  const overdue = open.filter((i) => i.state === "overdue");
  const dueSoon = open.filter((i) => isDueSoon(i, today));
  return {
    invoices,
    projects: projectRows,
    summary: {
      outstandingCents: sumOwed(open),
      outstandingInvoices: open.length,
      outstandingSuppliers: new Set(open.map((i) => i.subcontractorId)).size,
      overdueCents: sumOwed(overdue),
      overdueInvoices: overdue.length,
      dueSoonCents: sumOwed(dueSoon),
      dueSoonInvoices: dueSoon.length,
      paidThisMonthCents: month.reduce((sum, p) => sum + p.amountCents, 0),
      paymentsThisMonth: month.length,
    },
    today,
  };
}

/** What is owed by week of its due date (past due first), and the payments made. */
export async function listPayments(ctx: Ctx, filters: Filters = {}): Promise<TenantPayments> {
  const today = todayInSpain();
  const where = invoiceFilter(filters);
  const [loaded, payments] = await Promise.all([
    loadInvoices(ctx.tenantId, where, { lines: false }),
    loadPayments(ctx.tenantId, where),
  ]);
  const open = [...buildInvoices(loaded, today).items.values()].filter((i) => owed(i) && i.outstandingCents > 0 && i.dueOn);
  const forecast = forecastWeeks(today).map((week) => {
    const invoices = open
      .filter((i) => (week.from === null || i.dueOn! >= week.from) && i.dueOn! <= week.to)
      .sort((a, b) => a.dueOn!.localeCompare(b.dueOn!));
    return { ...week, totalCents: sumOwed(invoices), invoices };
  });
  const month = payments.filter((p) => p.paidOn >= monthStart(today));
  return {
    forecast,
    payments,
    summary: { monthCents: month.reduce((sum, p) => sum + p.amountCents, 0), monthPayments: month.length },
    today,
  };
}

/** What an invoice owes: payable, net of its credit notes, less what was paid. Mirrors `settle`. */
const outstandingSql = sql`(${purchaseInvoices.baseCents} + ${purchaseInvoices.vatCents} - ${purchaseInvoices.irpfCents} - ${purchaseInvoices.retentionCents})
  + coalesce((select sum(c.base_cents + c.vat_cents - c.irpf_cents - c.retention_cents) from ${purchaseInvoices} c where c.rectifies_id = ${purchaseInvoices.id}), 0)
  - coalesce((select sum(p.amount_cents) from ${purchasePayments} p where p.invoice_id = ${purchaseInvoices.id}), 0)`;

/** Compras' sections in the rail, and the invoices that need paying now (past due or due soon). */
export async function getPurchasingCounts(ctx: Ctx): Promise<PurchasingCounts> {
  const horizon = addDays(todayInSpain(), DUE_SOON_DAYS);
  const tenant = ctx.tenantId;
  // One round trip: the rail asks on every page.
  const [row] = await db.execute<{ orders: number; invoices: number; payments: number; due: number }>(sql`
    select
      (select count(*) from ${purchaseOrders} where tenant_id = ${tenant})::int as orders,
      (select count(*) from ${purchaseInvoices} where tenant_id = ${tenant})::int as invoices,
      (select count(*) from ${purchasePayments} where tenant_id = ${tenant})::int as payments,
      (select count(*) from ${purchaseInvoices}
        where ${purchaseInvoices.tenantId} = ${tenant} and ${purchaseInvoices.kind} = 'invoice'
          and ${purchaseInvoices.dueOn} <= ${horizon} and ${outstandingSql} > 0)::int as due`);
  return { orders: row?.orders ?? 0, invoices: row?.invoices ?? 0, payments: row?.payments ?? 0, dueAttention: row?.due ?? 0 };
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
    .where(eq(purchaseOrders.id, invoice.orderId));
  if (!order) fail("not_found");
  // A credit note's payments are its invoice's.
  const payer = payerOf(invoice);
  const [loaded, payments, fileRows, events, budget, [creator]] = await Promise.all([
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
 * amountCents }], else in proportion), notes?, file? (PDF) }. Only a placed
 * order takes invoices. → { invoiceId }
 */
export async function createInvoice(ctx: Ctx, orderId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
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
    db.transaction(async (tx) => {
      const locked = await lockPlacedOrder(tx, orderId);
      if (rectified) await checkCreditRoom(tx, rectified.id, amounts.baseCents);
      // Read again under the lock: an edit of the order's lines or schedule can't slip in between.
      const [current, schedule] = await Promise.all([
        tx.select({ lineageId: purchaseOrderLines.lineageId }).from(purchaseOrderLines).where(eq(purchaseOrderLines.orderId, orderId)),
        milestoneId
          ? tx.select({ id: purchaseOrderMilestones.id }).from(purchaseOrderMilestones).where(eq(purchaseOrderMilestones.id, milestoneId))
          : [],
      ]);
      const contracted = new Set(current.map((l) => l.lineageId));
      if (split.some((l) => !contracted.has(l.lineageId))) fail("unknown_line");
      if (milestoneId && schedule.length === 0) fail("invalid_input");
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
    }),
  );
  return { invoiceId };
}

/** A credit note never takes off more than its invoice and the invoice's other credit notes leave. */
async function checkCreditRoom(tx: Tx, invoiceId: string, addedCents: number) {
  // Locked: two credit notes at once can't both fit in what is left.
  await tx.select({ id: purchaseInvoices.id }).from(purchaseInvoices).where(eq(purchaseInvoices.id, invoiceId)).for("update");
  const [left] = await tx
    .select({ base: sql<string>`sum(${purchaseInvoices.baseCents})` })
    .from(purchaseInvoices)
    .where(sql`${purchaseInvoices.id} = ${invoiceId} or ${purchaseInvoices.rectifiesId} = ${invoiceId}`);
  if (Number(left?.base ?? 0) + addedCents < 0) fail("exceeds_amount");
}

/** The lines of the invoice a credit note rectifies: its split is the credit note's. */
const rectifiedLines = (ctx: Ctx, invoiceId: string) =>
  db
    .select({ lineageId: purchaseInvoiceLines.lineageId, amountCents: purchaseInvoiceLines.amountCents })
    .from(purchaseInvoiceLines)
    .where(and(eq(purchaseInvoiceLines.invoiceId, invoiceId), eq(purchaseInvoiceLines.tenantId, ctx.tenantId)));

/** What was paid on the invoice an invoice or credit note settles against. */
async function paidAgainst(run: Tx | typeof db, invoice: InvoiceRow) {
  const [row] = await run
    .select({ paid: sql<string>`coalesce(sum(${purchasePayments.amountCents}), 0)` })
    .from(purchasePayments)
    .where(eq(purchasePayments.invoiceId, payerOf(invoice)));
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
      await tx.select({ id: purchaseInvoices.id }).from(purchaseInvoices).where(eq(purchaseInvoices.id, invoiceId)).for("update");
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
          .where(eq(purchasePayments.invoiceId, invoiceId));
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

/** Removes an invoice nothing was paid on and no credit note rectifies, with its PDFs. */
export async function deleteInvoice(ctx: Ctx, invoiceId: string) {
  requireEditor(ctx);
  const invoice = await requireInvoice(ctx, invoiceId);
  const files = await db
    .select({ pathname: purchaseInvoiceFiles.pathname })
    .from(purchaseInvoiceFiles)
    .where(eq(purchaseInvoiceFiles.invoiceId, invoiceId));
  await db.transaction(async (tx) => {
    // Under the lock: a payment or credit note can't land between the check and the delete.
    await tx.select({ id: purchaseInvoices.id }).from(purchaseInvoices).where(eq(purchaseInvoices.id, invoiceId)).for("update");
    if (invoice.kind === "invoice" && (await paidAgainst(tx, invoice)) > 0) fail("has_payments");
    const [credit] = await tx.select({ id: purchaseInvoices.id }).from(purchaseInvoices).where(eq(purchaseInvoices.rectifiesId, invoiceId)).limit(1);
    if (credit) fail("has_invoices");
    await tx.delete(purchaseInvoices).where(eq(purchaseInvoices.id, invoiceId));
    await logEvent(tx, ctx, invoice.orderId, "invoice_deleted", { invoiceId, number: invoice.number, kind: invoice.kind });
  });
  // The PDFs go once the invoice is gone, so a refused delete never loses one.
  await Promise.all(files.map((f) => deleteFile(f.pathname).catch(() => {})));
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

/** The tenant's payment; `not_found` otherwise. */
async function requirePayment(ctx: Ctx, paymentId: string) {
  const payment = await db.query.purchasePayments.findFirst({
    where: and(eq(purchasePayments.id, paymentId), eq(purchasePayments.tenantId, ctx.tenantId)),
  });
  if (!payment) fail("not_found");
  return payment;
}

/**
 * Body: { amountCents, paidOn? (today by default; not before the invoice nor
 * after today), method? (transfer by default), reference?, file? (PDF proof) }.
 * Partial payments add up; past what is due, the retention is being
 * released; never more than the invoice's total, its credit notes off.
 * → { paymentId }
 */
export async function createPayment(ctx: Ctx, invoiceId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
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
    db.transaction(async (tx) => {
      // Locked: two payments at once can't both fit in what is left.
      await tx.select({ id: purchaseInvoices.id }).from(purchaseInvoices).where(eq(purchaseInvoices.id, invoiceId)).for("update");
      const group = await tx.select().from(purchaseInvoices).where(sql`${purchaseInvoices.id} = ${invoiceId} or ${purchaseInvoices.rectifiesId} = ${invoiceId}`);
      const own = group.find((g) => g.id === invoiceId)!;
      const settlement = settle(
        withTotals(own),
        group.filter((g) => g.id !== invoiceId).map(withTotals),
        await paidAgainst(tx, invoice),
      );
      if (amountCents > settlement.payableLeftCents) fail("exceeds_amount");
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
    }),
  );
  return { paymentId };
}

/** Removes a payment recorded by mistake, with its proof. */
export async function deletePayment(ctx: Ctx, paymentId: string) {
  requireEditor(ctx);
  const payment = await requirePayment(ctx, paymentId);
  const invoice = await requireInvoice(ctx, payment.invoiceId);
  await db.transaction(async (tx) => {
    await tx.delete(purchasePayments).where(eq(purchasePayments.id, paymentId));
    await logEvent(tx, ctx, invoice.orderId, "payment_deleted", {
      invoiceId: invoice.id,
      number: invoice.number,
      paymentId,
      amountCents: payment.amountCents,
      paidOn: payment.paidOn,
    });
  });
  if (payment.filePathname) await deleteFile(payment.filePathname).catch(() => {});
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
        .where(eq(purchaseInvoices.orderId, orderId)),
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
    if (dropped.length > 0) await tx.delete(purchaseOrderMilestones).where(inArray(purchaseOrderMilestones.id, dropped));
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
