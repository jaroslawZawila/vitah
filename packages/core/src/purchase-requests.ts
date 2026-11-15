import {
  and,
  asc,
  db,
  desc,
  eq,
  inArray,
  isNull,
  projects,
  purchaseOrders,
  purchaseRequestEvents,
  purchaseRequestLines,
  purchaseRequests,
  sql,
  subcontractors,
  users,
  type SQL,
} from "@repo/db";
import { canDecideRequest, requireEditor, type Ctx } from "./context";
import {
  isOpenRequest,
  type PurchaseKind,
  type PurchaseRequestDetail,
  type PurchaseRequestListItem,
  type TenantRequests,
} from "./contract";
import { daysPast } from "./control-calc";
import { forbidden } from "./errors";
import { idempotent, type Once } from "./idempotency";
import { changesOf, parse } from "./inputs/fields";
import { newRequestSchema, requestCancelSchema, requestChangesSchema, requestDecisionSchema } from "./inputs/purchase-requests";
import type { OrderLines } from "./inputs/purchasing";
import { todayInSpain } from "./obra-calc";
import { fail, groupBy, requireProject, userName, userNamesById } from "./obra-data";
import { projectNotDeleted } from "./project-client";
import { lockRequest, logRequestEvent } from "./purchase-request-data";
import {
  MAX_EVENTS,
  contractLines,
  contractedLines,
  contractsOf,
  diffLines,
  loadOrders,
  ofProject,
  projectList,
  requireSupplier,
} from "./purchasing";

// ─── Purchase requests (Compras › Solicitudes) ───────────────────────────────
// What an obra asks to buy before there is an order. Admins and managers
// request (and edit while pending, or cancel while open); an admin approves
// or rejects with a reason; an approved request becomes an order through
// createPurchase({ requestId }), which links the two. Every change is logged.
// Staff only; viewers read. The lock, history and ordering are in
// ./purchase-request-data, shared with ./purchasing.
// ─────────────────────────────────────────────────────────────────────────────

const sumCents = (rows: { amountCents: number }[]) => rows.reduce((sum, r) => sum + r.amountCents, 0);

/** Requests with their project, suggested supplier, order, lines and who asked and decided; newest first. Those of a deleted obra aside. */
async function loadRequests(tenantId: string, where?: SQL) {
  const rows = await db
    .select({
      request: purchaseRequests,
      projectRef: projects.ref,
      supplierName: subcontractors.legalName,
      orderNumber: purchaseOrders.number,
    })
    .from(purchaseRequests)
    .innerJoin(projects, eq(projects.id, purchaseRequests.projectId))
    .leftJoin(subcontractors, eq(subcontractors.id, purchaseRequests.subcontractorId))
    .leftJoin(purchaseOrders, eq(purchaseOrders.id, purchaseRequests.orderId))
    .where(and(eq(purchaseRequests.tenantId, tenantId), projectNotDeleted(), where))
    .orderBy(desc(purchaseRequests.createdAt), desc(purchaseRequests.number));
  const ids = rows.map((r) => r.request.id);
  const [lineRows, names] = await Promise.all([
    ids.length === 0
      ? []
      : db
          .select()
          .from(purchaseRequestLines)
          .where(and(eq(purchaseRequestLines.tenantId, tenantId), inArray(purchaseRequestLines.requestId, ids))),
    userNamesById(tenantId, rows.flatMap((r) => [r.request.createdById, r.request.decidedById])),
  ]);
  const lines = groupBy(lineRows, (l) => l.requestId);
  const nameOf = (id: string | null) => (id ? (names.get(id) ?? null) : null);
  return rows.map((row) => ({
    ...row,
    lines: lines.get(row.request.id) ?? [],
    createdBy: nameOf(row.request.createdById),
    decidedBy: nameOf(row.request.decidedById),
  }));
}

type LoadedRequest = Awaited<ReturnType<typeof loadRequests>>[number];

function toListItem(loaded: LoadedRequest, today: string): PurchaseRequestListItem {
  const { request, lines } = loaded;
  return {
    id: request.id,
    projectId: request.projectId,
    projectRef: loaded.projectRef,
    number: request.number,
    kind: request.kind,
    description: request.description,
    neededBy: request.neededBy,
    subcontractorId: request.subcontractorId,
    supplierName: loaded.supplierName,
    status: request.status,
    amountCents: sumCents(lines),
    chapterCodes: [...new Set(lines.map((l) => l.chapterCode))].sort(),
    createdBy: loaded.createdBy,
    createdAt: request.createdAt.toISOString(),
    decidedAt: request.decidedAt?.toISOString() ?? null,
    order: request.orderId && loaded.orderNumber !== null ? { id: request.orderId, number: loaded.orderNumber } : null,
    lateDays: isOpenRequest(request.status) ? daysPast(request.neededBy, today) : null,
  };
}

/** Those to decide first, then those to order, then the rest; newest first within each. */
const RANK = { pending: 0, approved: 1, ordered: 2, rejected: 3, cancelled: 3 } as const;

// ─── Reads ───────────────────────────────────────────────────────────────────

/** The tenant's requests (or a project's), with what waits for approval and to be ordered. */
export async function listRequests(ctx: Ctx, filters: { projectId?: string } = {}): Promise<TenantRequests> {
  const today = todayInSpain();
  const { projectId } = filters;
  const [loaded, projectRows] = await Promise.all([
    loadRequests(ctx.tenantId, projectId ? eq(purchaseRequests.projectId, projectId) : undefined),
    // A project's own list filters by nothing else.
    projectId ? [] : projectList(ctx.tenantId),
  ]);
  const requests = loaded.map((l) => toListItem(l, today)).sort((a, b) => RANK[a.status] - RANK[b.status]);
  const pending = requests.filter((r) => r.status === "pending");
  const approved = requests.filter((r) => r.status === "approved");
  return {
    requests,
    projects: projectRows,
    summary: {
      pending: pending.length,
      pendingCents: sumCents(pending),
      approved: approved.length,
      approvedCents: sumCents(approved),
    },
  };
}

/** One request: its lines against the budget and what is contracted of them, its decision and history. */
export async function getRequest(ctx: Ctx, requestId: string): Promise<PurchaseRequestDetail> {
  const [[loaded], events] = await Promise.all([
    loadRequests(ctx.tenantId, eq(purchaseRequests.id, requestId)),
    db
      .select({ event: purchaseRequestEvents, by: userName })
      .from(purchaseRequestEvents)
      .leftJoin(users, eq(users.id, purchaseRequestEvents.userId))
      .where(and(eq(purchaseRequestEvents.requestId, requestId), eq(purchaseRequestEvents.tenantId, ctx.tenantId)))
      .orderBy(desc(purchaseRequestEvents.createdAt))
      .limit(MAX_EVENTS),
  ]);
  if (!loaded) fail("not_found");
  const { request } = loaded;
  const today = todayInSpain();
  const [budget, orders] = await Promise.all([
    // Without an accepted budget (none, or none any more) the lines show unlabelled.
    contractLines(ctx.tenantId, request.projectId),
    loadOrders(ctx.tenantId, ofProject(request.projectId)),
  ]);
  const contracts = contractsOf(orders, today);
  const codeOf = (line: (typeof loaded.lines)[number]) => budget.get(line.lineageId)?.code ?? line.chapterCode;
  return {
    ...toListItem(loaded, today),
    notes: request.notes,
    decidedBy: loaded.decidedBy,
    decisionNote: request.decisionNote,
    lines: [...loaded.lines]
      .sort((a, b) => codeOf(a).localeCompare(codeOf(b)))
      .map((line) => {
        const item = budget.get(line.lineageId);
        return {
          id: line.id,
          lineageId: line.lineageId,
          chapterCode: line.chapterCode,
          code: item?.code ?? null,
          description: item?.description ?? null,
          unit: item?.unit ?? null,
          quantity: item?.quantity ?? null,
          costCents: item?.amountCents ?? null,
          contractedCents: contracts.get(line.lineageId)?.contractedCents ?? 0,
          amountCents: line.amountCents,
        };
      }),
    events: events.map(({ event, by }) => ({
      id: event.id,
      action: event.action,
      detail: event.detail,
      note: event.note,
      by,
      at: event.createdAt.toISOString(),
    })),
  };
}

// ─── Writes ──────────────────────────────────────────────────────────────────

/** The order form's lines without closing anything: each a contract line once, with an estimate. */
const requestLines = (given: OrderLines, contract: Awaited<ReturnType<typeof contractLines>>) =>
  contractedLines(given, contract).map(({ lineageId, chapterCode, amountCents }) => ({ lineageId, chapterCode, amountCents }));

/** The suggested supplier, if any: the tenant's, able to take this kind. */
const optionalSupplier = (ctx: Ctx, subcontractorId: string | null, kind: PurchaseKind) =>
  subcontractorId === null ? null : requireSupplier(ctx, subcontractorId, kind);

/**
 * Body: { kind, description, lines: [{ lineageId, amountCents }], neededBy?,
 * subcontractorId? (a suggested supplier), notes?, idempotencyKey? (sent
 * again with the same key, it is one request with one number: ./idempotency) }.
 * → { requestId, number }
 */
export async function createRequest(ctx: Ctx, projectId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  return idempotent<{ requestId: string; number: number }>(ctx, "purchase.request.create", { projectId }, input, (once) => makeRequest(ctx, projectId, input, once));
}

async function makeRequest(ctx: Ctx, projectId: string, input: Record<string, unknown>, once: Once<{ requestId: string; number: number }>) {
  // The kind and the supplier first, looked up with the project; then the rest.
  const { kind, subcontractorId: supplierId } = parse(newRequestSchema.pick({ kind: true, subcontractorId: true }), input);
  const [, contract, subcontractorId] = await Promise.all([
    requireProject(ctx.tenantId, projectId),
    contractLines(ctx.tenantId, projectId),
    optionalSupplier(ctx, supplierId, kind),
  ]);
  const { description, neededBy, notes, ...body } = parse(newRequestSchema.omit({ kind: true, subcontractorId: true }), input);
  const lines = requestLines(body.lines, contract);
  const sameProject = and(eq(purchaseRequests.projectId, projectId), eq(purchaseRequests.tenantId, ctx.tenantId));
  return db.transaction((tx) =>
    once(tx, async () => {
      // Two requests made at once may take the same number: the later one waits
      // for the first, then tries the next (each statement sees what is in by then).
      for (let attempt = 0; attempt < 5; attempt++) {
        const [row] = await tx
          .insert(purchaseRequests)
          .values({
            tenantId: ctx.tenantId,
            projectId,
            number: sql`(select coalesce(max(${purchaseRequests.number}), 0) + 1 from ${purchaseRequests} where ${sameProject})`,
            kind,
            description,
            neededBy,
            subcontractorId,
            notes,
            createdById: ctx.userId,
          })
          .onConflictDoNothing()
          .returning({ id: purchaseRequests.id, number: purchaseRequests.number });
        if (!row) continue;
        await tx.insert(purchaseRequestLines).values(lines.map((l) => ({ ...l, tenantId: ctx.tenantId, requestId: row.id })));
        await logRequestEvent(tx, ctx, row.id, "created", { number: row.number, amountCents: sumCents(lines), lines: lines.length });
        return { requestId: row.id, number: row.number };
      }
      throw new Error("Could not number the request");
    }),
  );
}

/**
 * Body: any of { kind, description, neededBy, subcontractorId, notes, lines },
 * while it is pending. Fields and lines are logged as an order's are. → { requestId }
 */
export async function updateRequest(ctx: Ctx, requestId: string, input: Record<string, unknown>) {
  requireEditor(ctx);
  const [request] = await db
    .select({ projectId: purchaseRequests.projectId, status: purchaseRequests.status })
    .from(purchaseRequests)
    .innerJoin(projects, eq(projects.id, purchaseRequests.projectId))
    .where(and(eq(purchaseRequests.id, requestId), eq(purchaseRequests.tenantId, ctx.tenantId), projectNotDeleted()));
  if (!request) fail("not_found");
  if (request.status !== "pending") fail("invalid_state");
  // What was sent, checked before the lock; compared with the row as it is under it.
  const { kind, lines: given, subcontractorId: supplierId, ...parsed } = changesOf(parse(requestChangesSchema, input));
  const contract = given ? await contractLines(ctx.tenantId, request.projectId) : null;
  const lines = given && contract ? requestLines(given, contract) : null;
  await db.transaction(async (tx) => {
    const locked = await lockRequest(tx, ctx, requestId, ["pending"]);
    const nextKind = kind ?? locked.kind;
    // The supplier, sent or kept, must take the kind it ends up with.
    const supplierSent = supplierId !== undefined;
    const subcontractorId =
      supplierSent || nextKind !== locked.kind
        ? await optionalSupplier(ctx, supplierSent ? supplierId : locked.subcontractorId, nextKind)
        : locked.subcontractorId;
    const next = { ...parsed, kind: nextKind, subcontractorId };
    const keys = (Object.keys(next) as (keyof typeof next)[]).filter((key) => next[key] !== undefined && next[key] !== locked[key]);
    if (keys.length > 0) {
      await tx
        .update(purchaseRequests)
        .set(Object.fromEntries(keys.map((key) => [key, next[key]])))
        .where(eq(purchaseRequests.id, requestId));
      const fields = Object.fromEntries(keys.map((key) => [key, { from: locked[key], to: next[key] }]));
      await logRequestEvent(tx, ctx, requestId, "updated", { fields });
    }
    if (!lines || !contract) return;
    // In budget order: the log lists the changes the same way whatever order the rows are read in.
    const before = await tx
      .select()
      .from(purchaseRequestLines)
      .where(eq(purchaseRequestLines.requestId, requestId))
      .orderBy(asc(purchaseRequestLines.chapterCode), asc(purchaseRequestLines.lineageId));
    const closing = (rows: { lineageId: string; chapterCode: string; amountCents: number }[]) =>
      rows.map((l) => ({ lineageId: l.lineageId, chapterCode: l.chapterCode, amountCents: l.amountCents, closesLine: true }));
    const changes = diffLines(closing(before), closing(lines), contract);
    if (changes.length === 0) return;
    await tx.delete(purchaseRequestLines).where(eq(purchaseRequestLines.requestId, requestId));
    await tx.insert(purchaseRequestLines).values(lines.map((l) => ({ ...l, tenantId: ctx.tenantId, requestId })));
    await logRequestEvent(tx, ctx, requestId, "lines", { changes });
  });
  return { requestId };
}

/** Body: { decision: "approve" | "reject", note? (required to reject) }. Admins only, while pending. → { requestId, status } */
export async function decideRequest(ctx: Ctx, requestId: string, input: Record<string, unknown>) {
  if (!canDecideRequest(ctx.role)) throw forbidden();
  const { decision, note } = parse(requestDecisionSchema, input);
  if (decision === "reject" && !note) fail("missing_fields");
  const status = decision === "approve" ? "approved" : "rejected";
  await db.transaction(async (tx) => {
    await lockRequest(tx, ctx, requestId, ["pending"]);
    await tx
      .update(purchaseRequests)
      .set({ status, decidedById: ctx.userId, decidedAt: new Date(), decisionNote: note })
      .where(eq(purchaseRequests.id, requestId));
    await logRequestEvent(tx, ctx, requestId, status, {}, note);
  });
  return { requestId, status };
}

/** Body: { note? }: withdraws a request still open (pending or approved, not ordered). → { requestId } */
export async function cancelRequest(ctx: Ctx, requestId: string, input: Record<string, unknown> = {}) {
  requireEditor(ctx);
  const { note } = parse(requestCancelSchema, input);
  await db.transaction(async (tx) => {
    const request = await lockRequest(tx, ctx, requestId, ["pending", "approved"]);
    await tx.update(purchaseRequests).set({ status: "cancelled" }).where(eq(purchaseRequests.id, requestId));
    await logRequestEvent(tx, ctx, requestId, "cancelled", { from: request.status }, note);
  });
  return { requestId };
}
