import {
  and,
  db,
  eq,
  isNotNull,
  isNull,
  obraIssueFiles,
  obraIssues,
  projectDocuments,
  projectPhotos,
  projects,
  purchaseInvoices,
  purchaseOrderDocumentVersions,
  purchaseOrderDocuments,
  purchaseOrders,
  purchasePayments,
  sql,
  subcontractorAssignments,
  subcontractors,
  users,
  type AnyColumn,
  type SQL,
} from "@repo/db";
import { isUniqueViolation } from "./accounts";
import { markChanged } from "./changes";
import { requireAdmin, type Ctx } from "./context";
import {
  CHANGE_AREAS,
  DELETED_KINDS,
  isDeletedKind,
  orderLabel,
  type DeletedBlock,
  type DeletedItem,
  type DeletedKind,
  type DeletedList,
  type DeletedProjectOption,
} from "./contract";
import { CoreError } from "./errors";
import { logWarn } from "./log";
import { fail } from "./obra-data";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./paging";
import { projectInTenant, projectsInTenant, type Tx } from "./project-client";
import { checkInvoiceRestorable, checkPaymentRestorable } from "./purchase-invoices";
import { logEvent } from "./purchasing";
import { audit } from "./subcontractor-network";

// ─── Deleted records (Elementos eliminados) ──────────────────────────────────
// Nothing a user deletes is erased: a project, a project document or photo, an
// incident's file, a company's assignment to an obra, an order's document, a
// supplier's invoice or payment keep their row (`deleted_at`, `deleted_by_id`)
// and their files, and every read leaves them out. Here an admin sees those
// rows, newest deletion first, and brings one back: the marks are cleared
// under a row lock, once what the record's own module asks of a new one still
// holds (a free ref or number, a parent that is there, amounts that fit).
// A restore leaves a trace: an entry in the order's history or the company's
// audit log where there is one, else a log line (`deleted.restored`).
// Nothing here erases anything: there is no purge.
// Admins only, and only their tenant's rows. Web-only: a restored document or
// photo reaches the client's app through the change counters (./changes), and
// pushes nothing: the client was told once already.
// ─────────────────────────────────────────────────────────────────────────────

/** A refusal of this module's own (the modules' checks throw theirs): the record can't come back as things stand, 409. */
function blocked(code: DeletedBlock): never {
  throw new CoreError(code, 409);
}

// ─── The list ────────────────────────────────────────────────────────────────

type Row = {
  kind: DeletedKind;
  id: string;
  /** `deleted_at` to the microsecond, as the cursor carries it. */
  at: string;
  deleted_by_id: string | null;
  deleted_by_name: string | null;
  project_id: string;
  project_ref: string;
  project_deleted: boolean;
  label: string;
  detail: string | null;
  number: number | null;
  day: string | null;
  amount_cents: string | null;
  block: DeletedBlock | null;
  parent_label: string | null;
};

type Naming = Partial<Record<"detail" | "number" | "day" | "amount" | "block" | "parent", SQL>>;

/** The columns after `label`, the same for every kind: what it doesn't have is null. */
const naming = ({ detail, number, day, amount, block, parent }: Naming = {}) => sql`
  ${detail ?? sql`null::text`} as detail, ${number ?? sql`null::int`} as number, ${day ?? sql`null::text`} as day,
  ${amount ?? sql`null::bigint`} as amount_cents, ${block ?? sql`null::text`} as block, ${parent ?? sql`null::text`} as parent_label`;

/**
 * Each kind's deleted rows in one shape: what names it (`label`, `detail`,
 * `number`, `day`, `amount_cents`), its obra, and what already stands in the
 * way of restoring it (`block`; `parent_label` is the deleted invoice a
 * payment or a credit note hangs from). A deleted obra is added by the caller.
 */
function deletedRows(tenantId: string): Record<DeletedKind, SQL> {
  return {
    // Its ref taken by another project since stands in the way.
    project: sql`
      select 'project' as kind, p.id, p.deleted_at, p.deleted_by_id, p.id as project_id, p.ref as label,
        ${naming({
          detail: sql`p.address`,
          block: sql`case when exists (
            select 1 from ${projects} l where l.tenant_id = p.tenant_id and l.ref = p.ref and l.deleted_at is null
          ) then 'ref_taken' end`,
        })}
      from ${projects} p
      where p.tenant_id = ${tenantId} and p.deleted_at is not null`,
    document: sql`
      select 'document' as kind, d.id, d.deleted_at, d.deleted_by_id, d.project_id, d.title as label,
        ${naming({ detail: sql`d.filename` })}
      from ${projectDocuments} d
      where d.tenant_id = ${tenantId} and d.deleted_at is not null`,
    // Its caption, else the day it was taken (its upload day in Spain without one, as the photos' own lists have it).
    photo: sql`
      select 'photo' as kind, f.id, f.deleted_at, f.deleted_by_id, f.project_id,
        coalesce(nullif(btrim(f.caption), ''), f.day) as label, ${naming({ day: sql`f.day` })}
      from (
        select *, coalesce(taken_on, (created_at at time zone 'UTC' at time zone 'Europe/Madrid')::date)::text as day
        from ${projectPhotos}
      ) f
      where f.tenant_id = ${tenantId} and f.deleted_at is not null`,
    // `detail` and `number` are its incident's kind and number (INC-003).
    issue_file: sql`
      select 'issue_file' as kind, f.id, f.deleted_at, f.deleted_by_id, i.project_id, f.filename as label,
        ${naming({ detail: sql`i.kind`, number: sql`i.number` })}
      from ${obraIssueFiles} f
      join ${obraIssues} i on i.id = f.issue_id
      where f.tenant_id = ${tenantId} and f.deleted_at is not null`,
    assignment: sql`
      select 'assignment' as kind, a.id, a.deleted_at, a.deleted_by_id, a.project_id, s.legal_name as label, ${naming()}
      from ${subcontractorAssignments} a
      join ${subcontractors} s on s.id = a.subcontractor_id
      where a.tenant_id = ${tenantId} and a.deleted_at is not null`,
    // `detail` and `number` are its order's description and number (PED-001).
    order_document: sql`
      select 'order_document' as kind, d.id, d.deleted_at, d.deleted_by_id, o.project_id, d.title as label,
        ${naming({ detail: sql`o.description`, number: sql`o.number` })}
      from ${purchaseOrderDocuments} d
      join ${purchaseOrders} o on o.id = d.order_id
      where d.tenant_id = ${tenantId} and d.deleted_at is not null`,
    // A credit note of a deleted invoice waits for it; a number used again since stands in the way.
    invoice: sql`
      select 'invoice' as kind, i.id, i.deleted_at, i.deleted_by_id, o.project_id, i.number as label,
        ${naming({
          detail: sql`s.legal_name`,
          day: sql`i.issued_on::text`,
          amount: sql`(i.base_cents + i.vat_cents - i.irpf_cents)::bigint`,
          block: sql`case
            when r.deleted_at is not null then 'parent_deleted'
            when exists (
              select 1 from ${purchaseInvoices} l
              where l.tenant_id = i.tenant_id and l.subcontractor_id = i.subcontractor_id and l.number = i.number and l.deleted_at is null
            ) then 'duplicate_number'
          end`,
          parent: sql`case when r.deleted_at is not null then r.number end`,
        })}
      from ${purchaseInvoices} i
      join ${purchaseOrders} o on o.id = i.order_id
      join ${subcontractors} s on s.id = i.subcontractor_id
      left join ${purchaseInvoices} r on r.id = i.rectifies_id
      where i.tenant_id = ${tenantId} and i.deleted_at is not null`,
    // A payment of a deleted invoice waits for it.
    payment: sql`
      select 'payment' as kind, p.id, p.deleted_at, p.deleted_by_id, o.project_id, i.number as label,
        ${naming({
          detail: sql`s.legal_name`,
          day: sql`p.paid_on::text`,
          amount: sql`p.amount_cents::bigint`,
          block: sql`case when i.deleted_at is not null then 'parent_deleted' end`,
          parent: sql`case when i.deleted_at is not null then i.number end`,
        })}
      from ${purchasePayments} p
      join ${purchaseInvoices} i on i.id = p.invoice_id
      join ${purchaseOrders} o on o.id = i.order_id
      join ${subcontractors} s on s.id = i.subcontractor_id
      where p.tenant_id = ${tenantId} and p.deleted_at is not null`,
  };
}

const issueLabel = (kind: string | null, number: number) => `${kind === "change" ? "CAM" : "INC"}-${String(number).padStart(3, "0")}`;

function toItem(row: Row): DeletedItem {
  // A deleted obra comes first: nothing of it can be reached until it is back.
  const underDeletedProject = row.kind !== "project" && row.project_deleted;
  const block = underDeletedProject ? "parent_deleted" : row.block;
  const detail =
    row.kind === "issue_file" && row.number !== null
      ? issueLabel(row.detail, row.number)
      : row.kind === "order_document" && row.number !== null
        ? [orderLabel(row.number), row.detail].filter(Boolean).join(" · ")
        : row.detail;
  return {
    kind: row.kind,
    id: row.id,
    label: row.label,
    detail,
    day: row.day,
    amountCents: row.amount_cents === null ? null : Number(row.amount_cents),
    projectId: row.project_id,
    projectRef: row.project_ref,
    // Stored in UTC, without a zone.
    deletedAt: new Date(`${row.at}Z`).toISOString(),
    deletedBy: row.deleted_by_id ? { id: row.deleted_by_id, name: row.deleted_by_name ?? "" } : null,
    restorable: block ?? true,
    parent:
      block !== "parent_deleted"
        ? null
        : underDeletedProject
          ? { kind: "project", label: row.project_ref }
          : { kind: "invoice", label: row.parent_label ?? "" },
  };
}

/** `<deleted_at to the microsecond>_<id>`: where a page ended. */
const CURSOR = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6})_([\w-]{1,64})$/;

/** A moment that exists (not the 30th of February), so the database never has to say so. */
function isMoment(at: string) {
  const time = Date.parse(`${at}Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 23) === at.slice(0, 23);
}

function parseFilters(input: Record<string, unknown>) {
  const given = (value: unknown) => value !== undefined && value !== null && value !== "";
  const kind = given(input.kind) ? input.kind : undefined;
  if (kind !== undefined && !isDeletedKind(kind)) fail("invalid_input");
  const projectId = given(input.projectId) ? input.projectId : undefined;
  if (projectId !== undefined && typeof projectId !== "string") fail("invalid_input");
  // The lists' one policy for a page's size (./paging): 50 unless asked, never more than 200.
  const limit = given(input.limit) ? Number(input.limit) : DEFAULT_PAGE_SIZE;
  if (!Number.isInteger(limit) || limit < 1) fail("invalid_input");
  const cursor = given(input.cursor) ? CURSOR.exec(String(input.cursor)) : undefined;
  if (cursor === null || (cursor && !isMoment(cursor[1]!))) fail("invalid_input");
  return { kind, projectId, limit: Math.min(limit, MAX_PAGE_SIZE), after: cursor ? { at: cursor[1]!, id: cursor[2]! } : null };
}

const union = (parts: SQL[]) => sql.join(parts, sql` union all `);

/**
 * The tenant's deleted records, newest deletion first, a page at a time
 * (`limit` 50 by default, 200 at most, as every list; `cursor` is the last page's
 * `nextCursor`). `kind` and `projectId` narrow it. Only what was itself
 * deleted is listed: what hangs from a deleted obra is not, unless it was
 * deleted too, and then it waits for its obra (`restorable: "parent_deleted"`).
 * The first page also brings the obras that have deleted records (`projects`).
 */
export async function listDeleted(ctx: Ctx, input: Record<string, unknown> = {}): Promise<DeletedList> {
  requireAdmin(ctx);
  const { kind, projectId, limit, after } = parseFilters(input);
  const byKind = deletedRows(ctx.tenantId);
  const kinds = kind ? [kind] : DELETED_KINDS;
  const [rows, projectRows] = await Promise.all([
    db.execute<Row>(sql`
      select d.kind, d.id, to_char(d.deleted_at, 'YYYY-MM-DD"T"HH24:MI:SS.US') as at,
        d.deleted_by_id, coalesce(u.name, u.email) as deleted_by_name,
        d.project_id, pr.ref as project_ref, (pr.deleted_at is not null) as project_deleted,
        d.label, d.detail, d.number, d.day, d.amount_cents, d.block, d.parent_label
      from (${union(kinds.map((k) => byKind[k]))}) d
      join ${projects} pr on pr.id = d.project_id
      left join ${users} u on u.id = d.deleted_by_id
      where pr.tenant_id = ${ctx.tenantId}
        ${projectId ? sql`and d.project_id = ${projectId}` : sql``}
        ${after ? sql`and (d.deleted_at, d.id) < (${after.at}::timestamp, ${after.id})` : sql``}
      order by d.deleted_at desc, d.id desc
      limit ${limit + 1}`),
    // The filter's obras: whatever is filtered, asked once per list.
    after
      ? null
      : db.execute<DeletedProjectOption>(sql`
          select distinct pr.id, pr.ref, (pr.deleted_at is not null) as deleted
          from (${union(DELETED_KINDS.map((k) => byKind[k]))}) d
          join ${projects} pr on pr.id = d.project_id
          where pr.tenant_id = ${ctx.tenantId}
          order by pr.ref, pr.id`),
  ]);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    items: page.map(toItem),
    nextCursor: rows.length > limit && last ? `${last.at}_${last.id}` : null,
    ...(projectRows ? { projects: projectRows.map((p) => ({ id: p.id, ref: p.ref, deleted: p.deleted })) } : {}),
  };
}

// ─── Restoring ───────────────────────────────────────────────────────────────

/** What a restore sets on its row: the marks of its deletion cleared, nothing else. */
const RESTORED = { deletedAt: null, deletedById: null };

type SoftDeletable = { id: AnyColumn; tenantId: AnyColumn; deletedAt: AnyColumn };

/** The tenant's row `id`, deleted: what a restore locks. Not there, another tenant's or not deleted: no row. */
const deletedRow = (table: SoftDeletable, ctx: Ctx, id: string) =>
  and(eq(table.id, id), eq(table.tenantId, ctx.tenantId), isNotNull(table.deletedAt));

/** The record's obra, unless it is itself deleted (`parent_deleted`: the obra comes back first). */
async function requireLiveProject(tx: Tx, ctx: Ctx, projectId: string) {
  const [project] = await tx
    .select({ id: projects.id, ref: projects.ref })
    .from(projects)
    .where(projectInTenant(ctx.tenantId, projectId));
  if (!project) blocked("parent_deleted");
  return project;
}

/** The trace of a restore that has no history of its own to go to. */
const logRestored = (ctx: Ctx, kind: DeletedKind, id: string) =>
  logWarn("deleted.restored", undefined, { kind, id, tenantId: ctx.tenantId, userId: ctx.userId });

type Restored = { projectId: string };

/** A project: its ref must still be free (the admin renames or deletes the one that took it). */
async function restoreProject(ctx: Ctx, id: string): Promise<Restored> {
  try {
    await db.transaction(async (tx) => {
      const [row] = await tx.select({ ref: projects.ref }).from(projects).where(deletedRow(projects, ctx, id)).for("update");
      if (!row) fail("not_found");
      const [taken] = await tx
        .select({ id: projects.id })
        .from(projects)
        .where(and(projectsInTenant(ctx.tenantId), eq(projects.ref, row.ref)))
        .limit(1);
      if (taken) blocked("ref_taken");
      await tx.update(projects).set(RESTORED).where(eq(projects.id, id));
    });
  } catch (error) {
    // A project created with its ref between the check and the write.
    if (isUniqueViolation(error, "projects_tenant_ref_unique")) blocked("ref_taken");
    throw error;
  }
  // Back in its client's app, with everything under it.
  await markChanged(ctx.tenantId, id, CHANGE_AREAS);
  logRestored(ctx, "project", id);
  return { projectId: id };
}

/** A project document or photo: its obra is there; the client's app reloads that part, and is pushed nothing. */
async function restoreProjectFile(ctx: Ctx, kind: "document" | "photo", id: string): Promise<Restored> {
  const table = kind === "document" ? projectDocuments : projectPhotos;
  const projectId = await db.transaction(async (tx) => {
    const [row] = await tx.select({ projectId: table.projectId }).from(table).where(deletedRow(table, ctx, id)).for("update");
    if (!row) fail("not_found");
    await requireLiveProject(tx, ctx, row.projectId);
    await tx.update(table).set(RESTORED).where(eq(table.id, id));
    return row.projectId;
  });
  await markChanged(ctx.tenantId, projectId, [kind === "document" ? "documents" : "photos"]);
  logRestored(ctx, kind, id);
  return { projectId };
}

/** An incident's file: its incident (never deleted) and the obra are there. */
async function restoreIssueFile(ctx: Ctx, id: string): Promise<Restored> {
  const projectId = await db.transaction(async (tx) => {
    const [row] = await tx
      .select({ issueId: obraIssueFiles.issueId })
      .from(obraIssueFiles)
      .where(deletedRow(obraIssueFiles, ctx, id))
      .for("update");
    if (!row) fail("not_found");
    const [issue] = await tx.select({ projectId: obraIssues.projectId }).from(obraIssues).where(eq(obraIssues.id, row.issueId));
    if (!issue) fail("not_found");
    await requireLiveProject(tx, ctx, issue.projectId);
    await tx.update(obraIssueFiles).set(RESTORED).where(eq(obraIssueFiles.id, id));
    return issue.projectId;
  });
  logRestored(ctx, "issue_file", id);
  return { projectId };
}

/**
 * A company's assignment to an obra, as it was when it was taken off: the
 * obra is there and the company still works on site (`supplies_only`: a
 * material supplier has no obras). Assigned again since, the same row is live
 * already: nothing to restore (`not_found`).
 */
async function restoreAssignment(ctx: Ctx, id: string): Promise<Restored> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ subcontractorId: subcontractorAssignments.subcontractorId, projectId: subcontractorAssignments.projectId })
      .from(subcontractorAssignments)
      .where(deletedRow(subcontractorAssignments, ctx, id))
      .for("update");
    if (!row) fail("not_found");
    const project = await requireLiveProject(tx, ctx, row.projectId);
    const [company] = await tx
      .select({ suppliesOnly: subcontractors.suppliesOnly })
      .from(subcontractors)
      .where(and(eq(subcontractors.id, row.subcontractorId), eq(subcontractors.tenantId, ctx.tenantId)));
    if (!company) fail("not_found");
    if (company.suppliesOnly) fail("supplies_only");
    await tx.update(subcontractorAssignments).set(RESTORED).where(eq(subcontractorAssignments.id, id));
    await audit(tx, ctx, row.subcontractorId, "assignment_restored", { projectId: project.id, projectRef: project.ref });
    return { projectId: project.id };
  });
}

/** The order's obra, unless deleted (`parent_deleted`). Orders themselves are never deleted, only cancelled. */
async function requireLiveOrder(tx: Tx, ctx: Ctx, orderId: string) {
  const [order] = await tx
    .select({ projectId: purchaseOrders.projectId })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, orderId), eq(purchaseOrders.tenantId, ctx.tenantId)));
  if (!order) fail("not_found");
  await requireLiveProject(tx, ctx, order.projectId);
  return order;
}

/** An order's document, with all its versions: its order's obra is there. */
async function restoreOrderDocument(ctx: Ctx, id: string): Promise<Restored> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select({ orderId: purchaseOrderDocuments.orderId, title: purchaseOrderDocuments.title })
      .from(purchaseOrderDocuments)
      .where(deletedRow(purchaseOrderDocuments, ctx, id))
      .for("update");
    if (!row) fail("not_found");
    const order = await requireLiveOrder(tx, ctx, row.orderId);
    await tx.update(purchaseOrderDocuments).set(RESTORED).where(eq(purchaseOrderDocuments.id, id));
    const versions = await tx
      .select({ id: purchaseOrderDocumentVersions.id })
      .from(purchaseOrderDocumentVersions)
      .where(eq(purchaseOrderDocumentVersions.documentId, id));
    await logEvent(tx, ctx, row.orderId, "document_restored", { documentId: id, title: row.title, versions: versions.length });
    return { projectId: order.projectId };
  });
}

/**
 * A supplier's invoice or credit note: its obra is there, a credit note's
 * invoice too (`parent_deleted`), its number is still free for that supplier
 * (`duplicate_number`), and it fits its order as a new one would
 * (`checkInvoiceRestorable`, with `createInvoice`'s own codes).
 */
async function restoreInvoice(ctx: Ctx, id: string): Promise<Restored> {
  try {
    return await db.transaction(async (tx) => {
      const [invoice] = await tx.select().from(purchaseInvoices).where(deletedRow(purchaseInvoices, ctx, id)).for("update");
      if (!invoice) fail("not_found");
      const order = await requireLiveOrder(tx, ctx, invoice.orderId);
      if (invoice.rectifiesId) {
        const [rectified] = await tx
          .select({ id: purchaseInvoices.id })
          .from(purchaseInvoices)
          .where(and(eq(purchaseInvoices.id, invoice.rectifiesId), isNull(purchaseInvoices.deletedAt)));
        if (!rectified) blocked("parent_deleted");
      }
      const [taken] = await tx
        .select({ id: purchaseInvoices.id })
        .from(purchaseInvoices)
        .where(
          and(
            eq(purchaseInvoices.tenantId, ctx.tenantId),
            eq(purchaseInvoices.subcontractorId, invoice.subcontractorId),
            eq(purchaseInvoices.number, invoice.number),
            isNull(purchaseInvoices.deletedAt),
          ),
        )
        .limit(1);
      if (taken) blocked("duplicate_number");
      await checkInvoiceRestorable(tx, invoice);
      await tx.update(purchaseInvoices).set(RESTORED).where(eq(purchaseInvoices.id, id));
      await logEvent(tx, ctx, invoice.orderId, "invoice_restored", { invoiceId: id, number: invoice.number, kind: invoice.kind });
      return { projectId: order.projectId };
    });
  } catch (error) {
    // Its number registered again between the check and the write.
    if (isUniqueViolation(error, "purchase_invoices_supplier_number_unique")) blocked("duplicate_number");
    throw error;
  }
}

/**
 * A supplier's payment: its invoice and obra are there (`parent_deleted`),
 * and it still fits in what the invoice is owed (`checkPaymentRestorable`,
 * with `createPayment`'s own codes).
 */
async function restorePayment(ctx: Ctx, id: string): Promise<Restored> {
  return db.transaction(async (tx) => {
    const [payment] = await tx.select().from(purchasePayments).where(deletedRow(purchasePayments, ctx, id)).for("update");
    if (!payment) fail("not_found");
    const [invoice] = await tx.select().from(purchaseInvoices).where(eq(purchaseInvoices.id, payment.invoiceId));
    if (!invoice) fail("not_found");
    const order = await requireLiveOrder(tx, ctx, invoice.orderId);
    if (invoice.deletedAt) blocked("parent_deleted");
    await checkPaymentRestorable(tx, invoice, payment);
    await tx.update(purchasePayments).set(RESTORED).where(eq(purchasePayments.id, id));
    await logEvent(tx, ctx, invoice.orderId, "payment_restored", {
      invoiceId: invoice.id,
      number: invoice.number,
      paymentId: id,
      amountCents: payment.amountCents,
      paidOn: payment.paidOn,
    });
    return { projectId: order.projectId };
  });
}

const RESTORE: Record<DeletedKind, (ctx: Ctx, id: string) => Promise<Restored>> = {
  project: restoreProject,
  document: (ctx, id) => restoreProjectFile(ctx, "document", id),
  photo: (ctx, id) => restoreProjectFile(ctx, "photo", id),
  issue_file: restoreIssueFile,
  assignment: restoreAssignment,
  order_document: restoreOrderDocument,
  invoice: restoreInvoice,
  payment: restorePayment,
};

/**
 * Brings a deleted record back: every read finds it again, as it was. Admin
 * only. `not_found` if it isn't the tenant's, isn't deleted (restored
 * already) or `kind` is none of `DELETED_KINDS`; otherwise what stands in the
 * way, by kind (above). → { kind, id, projectId }
 */
export async function restoreDeleted(ctx: Ctx, kind: unknown, id: string) {
  requireAdmin(ctx);
  if (!isDeletedKind(kind)) fail("not_found");
  const { projectId } = await RESTORE[kind](ctx, id);
  return { kind, id, projectId };
}
