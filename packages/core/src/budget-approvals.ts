import {
  and,
  budgetApprovals,
  budgetRevisionChanges,
  budgetRevisions,
  db,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  obraIssues,
  projectDocuments,
  projects,
  sql,
} from "@repo/db";
import { checkOwnPassword } from "./accounts";
import { chosenOptions, revisionInProject } from "./budget-draft";
import { markChanged } from "./changes";
import { clientUser } from "./client-account";
import { resolveClientProject, clientProjectsWhere } from "./client-projects";
import type { Ctx } from "./context";
import type {
  ApprovalError,
  BudgetApproval,
  BudgetApprovalStatus,
  LinkedChange,
  MobileApproval,
  MobileApprovalDecisionReply,
} from "./contract";
import { CoreError } from "./errors";
import { approvalDecisionSchema, askApprovalSchema } from "./inputs/budget-approvals";
import { parse } from "./inputs/fields";
import { MAX_AMOUNT_CENTS } from "./money";
import { notifyProjectClient } from "./notifications";
import { todayInSpain, withPrices } from "./obra-calc";
import { fail as obraFail, loadBudget, loadChapters, userNamesById, type RevisionRow } from "./obra-data";
import { isUniqueViolation } from "./pg-errors";
import { projectInTenant, projectNotDeleted, type Tx } from "./project-client";

// ─── Changes to the contract and the client's consent ─────────────────────────
// A revision from Rev.1 on changes the accepted contract. Staff link the
// changes it prices (CAM-, obra_issues of kind change: construction.ts), and
// may ask the project's client to approve the issued revision in the app. The
// client answers there, approving with their password. Their answer is
// evidence of consent, not the acceptance: registering that stays a staff act
// (budget.ts › acceptRevision), which then names the approval as its proof.
//
// When a request can be asked: on an issued revision of a project with an
// accepted contract (so from Rev.1 on) and an app client, with no later
// revision issued now (a later draft, or one rejected since, doesn't count:
// staff can still accept this one by hand too), and that has no request
// waiting nor one approved. It shows the client what is fixed now: the contract before and
// after (with the options proposed), the general PDF and the linked changes
// (copied into the request: an edit of a change afterwards alters neither what
// the client is shown nor the record of what they approved; the links freeze).
//
// When a waiting request closes, so the client never answers something no
// longer on the table: staff withdraw it, or it lapses when a later revision is
// issued, when staff accept or reject a revision of the project by hand, or
// when the project's client changes (./project-client.ts) or the project is
// deleted (./projects.ts). An answered request stays as it is.
//
// Locks: every write that puts a revision on the table or takes one off
// (asking, issuing, accepting, rejecting, changing the client) takes the
// project's row (`lockProjectRow`), so they run one at a time per project.
// It comes first, before the revision's row; only issuing takes its own
// draft's row first and the project's last (budget-issue.ts: not while the
// PDFs render), which is no cycle: nothing else locks the project and then a
// draft.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS: Record<ApprovalError, number> = {
  no_contract: 409,
  no_client: 409,
  no_pdf: 409,
  not_newest: 409,
  approval_pending: 409,
  already_approved: 409,
  approval_closed: 409,
  not_a_change: 400,
  links_frozen: 409,
};

function fail(code: ApprovalError): never {
  throw new CoreError(code, STATUS[code]);
}

/** The client's answer → the request's status (null for anything else). */
const statusOf = (decision: unknown): BudgetApprovalStatus | null =>
  decision === "approve" ? "approved" : decision === "reject" ? "rejected" : null;

const ofRevision = (revisionId: string) => eq(budgetApprovals.revisionId, revisionId);
const isPending = eq(budgetApprovals.status, "pending");

/**
 * The revision (as `budget_revisions`) still on the table: issued, and no later
 * one issued after it. Issuing lapses the requests below it; this holds even if
 * code without that (a rollback) left one open.
 */
const onTable = sql<boolean>`(${budgetRevisions.status} = 'issued' and not exists (
  select 1 from budget_revisions later
  where later.project_id = ${budgetRevisions.projectId} and later.status = 'issued' and later.number > ${budgetRevisions.number}
))`;

/**
 * The project's row, locked first by every write that puts a revision on the
 * table or takes one off (see the top of this file); `no key update`, so rows
 * that only point at the project (documents, issues…) are still written
 * meanwhile. `project_not_found` if it was deleted since the caller looked.
 */
export async function lockProjectRow(tx: Tx, tenantId: string, projectId: string) {
  const [project] = await tx
    .select({ clientUserId: projects.clientUserId })
    .from(projects)
    .where(projectInTenant(tenantId, projectId))
    .for("no key update");
  if (!project) obraFail("project_not_found");
  return project;
}

/** The revision locked for this write: requests and links of one revision never cross. */
async function lockRevision(tx: Tx, revisionId: string) {
  const [locked] = await tx
    .select({ status: budgetRevisions.status })
    .from(budgetRevisions)
    .where(eq(budgetRevisions.id, revisionId))
    .for("update");
  // Gone since the caller looked: a draft discarded meanwhile.
  if (!locked) obraFail("not_found");
  return locked.status;
}

// ─── Linking changes ─────────────────────────────────────────────────────────

/**
 * Links stay as the client was shown them: they change only on a draft or an
 * issued revision from Rev.1 on, with no request waiting or approved.
 */
async function changeLinks<T>(ctx: Ctx, projectId: string, revisionId: string, write: (tx: Tx, revision: RevisionRow) => Promise<T>) {
  const revision = await revisionInProject(ctx, projectId, revisionId, { draft: false });
  if (revision.number === 0) obraFail("invalid_state");
  return db.transaction(async (tx) => {
    const status = await lockRevision(tx, revisionId);
    if (status !== "draft" && status !== "issued") fail("links_frozen");
    const [held] = await tx
      .select({ id: budgetApprovals.id })
      .from(budgetApprovals)
      .where(and(ofRevision(revisionId), inArray(budgetApprovals.status, ["pending", "approved"])))
      .limit(1);
    if (held) fail("links_frozen");
    return write(tx, revision);
  });
}

/** Links a change (CAM-) of the project to the revision that prices it; linking it again changes nothing. */
export async function linkChange(ctx: Ctx, projectId: string, revisionId: string, issueId: string) {
  return changeLinks(ctx, projectId, revisionId, async (tx) => {
    const [issue] = await tx
      .select({ kind: obraIssues.kind })
      .from(obraIssues)
      .where(and(eq(obraIssues.id, issueId), eq(obraIssues.projectId, projectId), eq(obraIssues.tenantId, ctx.tenantId)));
    if (!issue) obraFail("not_found");
    if (issue.kind !== "change") fail("not_a_change");
    await tx
      .insert(budgetRevisionChanges)
      .values({ tenantId: ctx.tenantId, revisionId, issueId, linkedById: ctx.userId })
      .onConflictDoNothing();
    return { revisionId, issueId };
  });
}

export async function unlinkChange(ctx: Ctx, projectId: string, revisionId: string, issueId: string) {
  return changeLinks(ctx, projectId, revisionId, async (tx) => {
    const removed = await tx
      .delete(budgetRevisionChanges)
      .where(and(eq(budgetRevisionChanges.revisionId, revisionId), eq(budgetRevisionChanges.issueId, issueId)))
      .returning({ issueId: budgetRevisionChanges.issueId });
    if (removed.length === 0) obraFail("not_found");
    return { revisionId, issueId };
  });
}

/** The changes each revision of `revisionIds` prices now, oldest first (`run`: a transaction, or the pool). */
async function linkedChanges(run: Tx | typeof db, tenantId: string, revisionIds: string[]): Promise<Map<string, LinkedChange[]>> {
  const byRevision = new Map<string, LinkedChange[]>();
  if (revisionIds.length === 0) return byRevision;
  const rows = await run
    .select({
      revisionId: budgetRevisionChanges.revisionId,
      id: obraIssues.id,
      number: obraIssues.number,
      description: obraIssues.description,
      occurredOn: obraIssues.occurredOn,
      costImpactCents: obraIssues.costImpactCents,
    })
    .from(budgetRevisionChanges)
    .innerJoin(obraIssues, eq(obraIssues.id, budgetRevisionChanges.issueId))
    .where(and(eq(budgetRevisionChanges.tenantId, tenantId), inArray(budgetRevisionChanges.revisionId, revisionIds)))
    .orderBy(obraIssues.number);
  for (const { revisionId, ...change } of rows) byRevision.set(revisionId, [...(byRevision.get(revisionId) ?? []), change]);
  return byRevision;
}

/** The revisions that price each change of `issueIds` (Obra › Incidencias), by number. */
export async function revisionsOfChanges(tenantId: string, issueIds: string[]) {
  const byIssue = new Map<string, { id: string; number: number }[]>();
  if (issueIds.length === 0) return byIssue;
  const rows = await db
    .select({ issueId: budgetRevisionChanges.issueId, id: budgetRevisions.id, number: budgetRevisions.number })
    .from(budgetRevisionChanges)
    .innerJoin(budgetRevisions, eq(budgetRevisions.id, budgetRevisionChanges.revisionId))
    .where(and(eq(budgetRevisionChanges.tenantId, tenantId), inArray(budgetRevisionChanges.issueId, issueIds)))
    .orderBy(budgetRevisions.number);
  for (const { issueId, ...revision } of rows) byIssue.set(issueId, [...(byIssue.get(issueId) ?? []), revision]);
  return byIssue;
}

// ─── Asking the client ───────────────────────────────────────────────────────

/**
 * The revision's general PDF (a project document since it was issued), locked:
 * hiding it from the client (documents.ts) waits for the request, then sees it.
 */
async function generalPdf(tx: Tx, revisionId: string) {
  const [doc] = await tx
    .select({ id: projectDocuments.id, visibleToClient: projectDocuments.visibleToClient })
    .from(projectDocuments)
    .where(
      and(
        eq(projectDocuments.budgetRevisionId, revisionId),
        eq(projectDocuments.budgetPdf, "general"),
        isNull(projectDocuments.deletedAt),
      ),
    )
    .for("update");
  return doc;
}

/** Whether a request waiting or approved points at the document: the client must still be able to open it. */
export async function documentInApproval(tx: Tx, documentId: string) {
  const [held] = await tx
    .select({ id: budgetApprovals.id })
    .from(budgetApprovals)
    .where(and(eq(budgetApprovals.documentId, documentId), inArray(budgetApprovals.status, ["pending", "approved"])))
    .limit(1);
  return held !== undefined;
}

/** Amounts are stored as 32-bit integers: a total past the bound is a 400 like any amount too large. */
const fitsAmount = (cents: number) => Math.abs(cents) <= MAX_AMOUNT_CENTS;

/** A revision's chapters (its PEC) and `chosen` options, at the client's price without VAT. */
async function priceWith(revision: RevisionRow, chosen: Set<string>) {
  const priced = withPrices(await loadChapters(revision.id), revision);
  const counted = priced.filter((c) => c.kind === "chapter" || chosen.has(c.id));
  return { cents: counted.reduce((sum, c) => sum + c.priceCents, 0), options: priced.filter((c) => chosen.has(c.id)) };
}

/**
 * Asks the project's client to approve an issued revision in the app (see the
 * top of this file for when). Body: { message?, chosenOptionIds? } — the
 * options proposed as chosen, what the acceptance would record. The general
 * PDF is shown to the client if it wasn't, and the client is pushed.
 */
export async function askApproval(ctx: Ctx, projectId: string, revisionId: string, input: Record<string, unknown>) {
  const revision = await revisionInProject(ctx, projectId, revisionId, { draft: false });
  if (revision.status !== "issued") obraFail("not_issued");

  const asked = await db
    .transaction(async (tx) => {
      // The project, then the revision: issuing a later one takes the same, so it never misses this request.
      const project = await lockProjectRow(tx, ctx.tenantId, projectId);
      if ((await lockRevision(tx, revisionId)) !== "issued") obraFail("not_issued");
      const [later, held, pdf, contract] = await Promise.all([
        tx
          .select({ id: budgetRevisions.id })
          .from(budgetRevisions)
          .where(and(eq(budgetRevisions.projectId, projectId), eq(budgetRevisions.status, "issued"), gt(budgetRevisions.number, revision.number)))
          .limit(1),
        tx
          .select({ status: budgetApprovals.status })
          .from(budgetApprovals)
          .where(and(ofRevision(revisionId), inArray(budgetApprovals.status, ["pending", "approved"]))),
        generalPdf(tx, revisionId),
        loadBudget(ctx.tenantId, projectId),
      ]);
      if (later.length > 0) fail("not_newest");
      if (!contract.revision) fail("no_contract");
      if (!project.clientUserId) fail("no_client");
      if (held.some((r) => r.status === "pending")) fail("approval_pending");
      if (held.length > 0) fail("already_approved");
      if (!pdf) fail("no_pdf");

      // What staff sent, once the request can be asked (a 409 before a field's 400).
      const { message, chosenOptionIds = [] } = parse(askApprovalSchema, input);
      const chosen = await chosenOptions(revisionId, chosenOptionIds);
      const [after, changes] = await Promise.all([priceWith(revision, chosen), linkedChanges(tx, ctx.tenantId, [revisionId])]);
      const beforeCents = contract.progress.totalCents;
      if (!fitsAmount(beforeCents) || !fitsAmount(after.cents)) obraFail("invalid_input");

      const [row] = await tx
        .insert(budgetApprovals)
        .values({
          tenantId: ctx.tenantId,
          projectId,
          revisionId,
          clientUserId: project.clientUserId,
          message,
          chosenOptionIds: [...chosen],
          changes: changes.get(revisionId) ?? [],
          documentId: pdf.id,
          beforeCents,
          afterCents: after.cents,
          vatRateBp: revision.vatRateBp,
          askedById: ctx.userId,
        })
        .returning({ id: budgetApprovals.id });
      // What the client approves, they can open: shown once, like any document shown (no second push).
      if (!pdf.visibleToClient) {
        await tx
          .update(projectDocuments)
          .set({ visibleToClient: true, clientNotifiedAt: sql`coalesce(${projectDocuments.clientNotifiedAt}, now())`, updatedAt: new Date() })
          .where(eq(projectDocuments.id, pdf.id));
      }
      return { approvalId: row!.id, shown: !pdf.visibleToClient };
    })
    .catch((error: unknown) => {
      // Asked twice at once: the one open request per revision is the database's.
      if (isUniqueViolation(error, "budget_approvals_one_open")) fail("approval_pending");
      throw error;
    });

  await markChanged(ctx.tenantId, projectId, asked.shown ? ["obra", "documents"] : ["obra"]);
  await notifyProjectClient(ctx.tenantId, projectId, { kind: "approval", number: revision.number });
  return { approvalId: asked.approvalId };
}

/** Staff take back the request waiting on the revision (`approval_closed` when none is). */
export async function withdrawApproval(ctx: Ctx, projectId: string, revisionId: string) {
  await revisionInProject(ctx, projectId, revisionId, { draft: false });
  const [closed] = await db
    .update(budgetApprovals)
    .set({ status: "withdrawn", closedAt: new Date(), closedById: ctx.userId })
    .where(and(ofRevision(revisionId), eq(budgetApprovals.projectId, projectId), isPending))
    .returning({ id: budgetApprovals.id });
  if (!closed) fail("approval_closed");
  await markChanged(ctx.tenantId, projectId, ["obra"]);
  return { approvalId: closed.id };
}

/**
 * Within a staff act that takes revisions off the table: the requests waiting
 * on the project's revisions lapse (`except` one being issued: the others
 * lapse; `only` one rejected), closed by `userId`. Returns how many did; the
 * caller marks the obra changed when any did.
 */
export async function lapseApprovals(
  tx: Tx,
  projectId: string,
  userId: string,
  { except, only }: { except?: string; only?: string } = {},
) {
  const lapsed = await tx
    .update(budgetApprovals)
    .set({ status: "lapsed", closedAt: new Date(), closedById: userId })
    .where(
      and(
        eq(budgetApprovals.projectId, projectId),
        isPending,
        except ? ne(budgetApprovals.revisionId, except) : undefined,
        only ? ofRevision(only) : undefined,
      ),
    )
    .returning({ id: budgetApprovals.id });
  return lapsed.length;
}

/**
 * The approval the acceptance of `revisionId` names as its proof: the newest
 * approval of it by the project's client now, with exactly the options being
 * accepted; null when there is none (the options differ, nobody asked, or it
 * was a client the home no longer has).
 */
export async function approvalAsProof(tx: Tx, revisionId: string, chosen: Set<string>): Promise<string | null> {
  const approved = await tx
    .select({ id: budgetApprovals.id, chosenOptionIds: budgetApprovals.chosenOptionIds })
    .from(budgetApprovals)
    .innerJoin(projects, eq(projects.id, budgetApprovals.projectId))
    .where(
      and(
        ofRevision(revisionId),
        eq(budgetApprovals.status, "approved"),
        eq(budgetApprovals.decidedById, projects.clientUserId),
        projectNotDeleted(),
      ),
    )
    .orderBy(desc(budgetApprovals.decidedAt));
  const same = (ids: string[]) => ids.length === chosen.size && ids.every((id) => chosen.has(id));
  return approved.find((a) => same(a.chosenOptionIds))?.id ?? null;
}

/**
 * A revision's linked changes and its requests to the client, as the portal's
 * Budget shows them. While a request waits or stands approved (the links are
 * frozen), the changes are the ones it copied: what the client was shown.
 */
export async function revisionApprovals(tenantId: string, revisionId: string) {
  const [changes, rows] = await Promise.all([
    linkedChanges(db, tenantId, [revisionId]),
    db
      .select()
      .from(budgetApprovals)
      .where(and(ofRevision(revisionId), eq(budgetApprovals.tenantId, tenantId)))
      .orderBy(desc(budgetApprovals.createdAt)),
  ]);
  const names = await userNamesById(tenantId, rows.flatMap((r) => [r.askedById, r.decidedById, r.closedById]));
  const name = (id: string | null) => (id === null ? null : (names.get(id) ?? null));
  const approvals = rows.map(
    (r): BudgetApproval => ({
      id: r.id,
      status: r.status,
      message: r.message,
      chosenOptionIds: r.chosenOptionIds,
      beforeCents: r.beforeCents,
      afterCents: r.afterCents,
      vatRateBp: r.vatRateBp,
      documentId: r.documentId,
      askedAt: r.createdAt.toISOString(),
      askedBy: name(r.askedById),
      decidedAt: r.decidedAt?.toISOString() ?? null,
      decidedOn: r.decidedAt ? todayInSpain(r.decidedAt) : null,
      decidedBy: name(r.decidedById),
      rejectReason: r.rejectReason,
      closedAt: r.closedAt?.toISOString() ?? null,
      closedBy: name(r.closedById),
    }),
  );
  const held = rows.find((r) => r.status === "pending" || r.status === "approved");
  return { changes: held ? held.changes : (changes.get(revisionId) ?? []), approvals };
}

// ─── The client (mobile app) ─────────────────────────────────────────────────
// Called with the client's own identity (from their mobile token), never a
// staff `Ctx`: only the client a request was asked of answers it, on one of
// their homes.

/** The request waiting for the client on their home `projectId` (else the default one); null when none. */
export async function getClientApproval(
  tenantId: string,
  clientUserId: string,
  projectId?: string | null,
): Promise<MobileApproval | null> {
  const project = await resolveClientProject(tenantId, clientUserId, projectId);
  if (!project) return null;
  const [row] = await db
    .select({ approval: budgetApprovals, revision: budgetRevisions })
    .from(budgetApprovals)
    .innerJoin(budgetRevisions, eq(budgetRevisions.id, budgetApprovals.revisionId))
    .where(
      and(
        eq(budgetApprovals.projectId, project.id),
        eq(budgetApprovals.tenantId, tenantId),
        eq(budgetApprovals.clientUserId, clientUserId),
        isPending,
        // Still on the table (a request older code left open never shows).
        onTable,
      ),
    )
    .orderBy(desc(budgetApprovals.createdAt))
    .limit(1);
  if (!row) return null;
  const { approval, revision } = row;
  const priced = await priceWith(revision, new Set(approval.chosenOptionIds));
  return {
    id: approval.id,
    revisionNumber: revision.number,
    reference: revision.reference,
    changeReason: revision.changeReason,
    message: approval.message,
    askedAt: approval.createdAt.toISOString(),
    beforeCents: approval.beforeCents,
    afterCents: approval.afterCents,
    differenceCents: approval.afterCents - approval.beforeCents,
    vatRateBp: approval.vatRateBp,
    documentId: approval.documentId,
    changes: approval.changes.map(({ number, description }) => ({ number, description })),
    options: priced.options.map((o) => ({ name: o.name, priceCents: o.priceCents })),
  };
}

/**
 * The client answers a request asked of them. Body: { decision: "approve" |
 * "reject", password (to approve: their own, checked here and throttled like
 * changing it), reason (to reject) }. Only a waiting request on a revision
 * still on the table (`approval_closed` otherwise). What is recorded is who,
 * when, the answer and the reason; the amounts and the PDF are the request's,
 * fixed when it was asked, never anything the app sends. The same answer sent
 * again by the client who gave it (the reply to the first was lost) gets what
 * was recorded, checked like the first (the password too), and changes nothing.
 */
export async function decideApproval(
  tenantId: string,
  clientUserId: string,
  approvalId: string,
  input: Record<string, unknown>,
): Promise<MobileApprovalDecisionReply> {
  const [found] = await db
    .select({
      status: budgetApprovals.status,
      projectId: budgetApprovals.projectId,
      decidedById: budgetApprovals.decidedById,
      decidedAt: budgetApprovals.decidedAt,
    })
    .from(budgetApprovals)
    .innerJoin(projects, eq(projects.id, budgetApprovals.projectId))
    .where(
      and(
        eq(budgetApprovals.id, approvalId),
        eq(budgetApprovals.tenantId, tenantId),
        eq(budgetApprovals.clientUserId, clientUserId),
        // Still their home, and not deleted.
        clientProjectsWhere(tenantId, clientUserId),
      ),
    );
  if (!found) throw new CoreError("not_found", 404);
  // Their answer already recorded, as this one says: a retry.
  const asked = statusOf(input.decision);
  const recorded = (row: { status: BudgetApprovalStatus; decidedById: string | null }) =>
    row.status === asked && row.decidedById === clientUserId;
  if (found.status !== "pending" && !recorded(found)) fail("approval_closed");
  const { decision, password, reason } = parse(approvalDecisionSchema, input);
  if (decision === "approve") {
    if (!password) throw new CoreError("missing_fields", 400);
    await checkOwnPassword(clientUser(tenantId, clientUserId), clientUserId, password);
  } else if (!reason) {
    throw new CoreError("missing_fields", 400);
  }

  const status = statusOf(decision)!;
  const reply = (decidedAt: Date) => ({ approval: { id: approvalId, status, decidedAt: decidedAt.toISOString() } });
  if (found.status !== "pending") return reply(found.decidedAt!);

  const decided = await db.transaction(async (tx) => {
    // The revision first, as staff's acts take it (accepting, rejecting, issuing
    // locks it before closing requests): whichever comes first, the other sees it.
    const [revision] = await tx
      .select({ id: budgetRevisions.id, onTable })
      .from(budgetRevisions)
      .innerJoin(budgetApprovals, eq(budgetApprovals.revisionId, budgetRevisions.id))
      .where(eq(budgetApprovals.id, approvalId))
      .for("share", { of: budgetRevisions });
    const [locked] = await tx
      .select({ status: budgetApprovals.status, decidedById: budgetApprovals.decidedById, decidedAt: budgetApprovals.decidedAt })
      .from(budgetApprovals)
      .where(eq(budgetApprovals.id, approvalId))
      .for("update");
    // Sent twice at once: the second finds the first's answer.
    if (locked && recorded(locked)) return { at: locked.decidedAt!, again: true };
    if (locked?.status !== "pending" || !revision?.onTable) fail("approval_closed");
    const now = new Date();
    await tx
      .update(budgetApprovals)
      .set({ status, decidedById: clientUserId, decidedAt: now, rejectReason: decision === "reject" ? reason : null })
      .where(and(eq(budgetApprovals.id, approvalId), isPending));
    return { at: now, again: false };
  });
  if (!decided.again) await markChanged(tenantId, found.projectId, ["obra"]);
  return reply(decided.at);
}
