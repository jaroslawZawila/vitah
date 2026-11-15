// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { sql } from "drizzle-orm";
import { check, foreignKey, index, integer, jsonb, pgTable, primaryKey, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { budgetRevisions } from "./budget";
import { basisPoints, COLUMN_VALUES, oneOf } from "./checks";
import { obraIssues } from "./construction";
import { projectDocuments } from "./project-files";
import { tenants } from "./tenants";
import { underProject } from "./under-project";
import { users } from "./users";

// --- Budget: changes to the contract and the client's consent ---
// A revision from Rev.1 on changes an accepted contract. Staff link the
// changes (CAM-) it prices, and may ask the project's client to approve it in
// the app (packages/core/src/budget-approvals.ts). The client's answer is
// evidence of consent, not the acceptance: registering that stays a staff act.

// The changes (obra_issues of kind change) a revision prices. A change may be
// priced by more than one revision (a rejected one, then the one reworked from it).
export const budgetRevisionChanges = pgTable(
  "budget_revision_changes",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    revisionId: text("revision_id").notNull(),
    issueId: text("issue_id").notNull(),
    linkedById: text("linked_by_id").references(() => users.id, { onDelete: "set null" }),
    linkedAt: timestamp("linked_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "budget_revision_changes_pk", columns: [table.revisionId, table.issueId] }),
    issueIdx: index("budget_revision_changes_issue_idx").on(table.issueId),
    // Cascaded: a draft revision is deleted for real, and its links with it.
    revisionFk: foreignKey({
      name: "budget_revision_changes_revision_id_tenant_fk",
      columns: [table.tenantId, table.revisionId],
      foreignColumns: [budgetRevisions.tenantId, budgetRevisions.id],
    }).onDelete("cascade"),
    issueFk: foreignKey({
      name: "budget_revision_changes_issue_id_tenant_fk",
      columns: [table.tenantId, table.issueId],
      foreignColumns: [obraIssues.tenantId, obraIssues.id],
    }).onDelete("cascade"),
  }),
);

/** A linked change as a request copies it (core's `LinkedChange`). */
type ApprovalChange = { id: string; number: number; description: string; occurredOn: string; costImpactCents: number | null };

// A request to the project's client to approve an issued revision in the app,
// and their answer. pending → approved | rejected (the client) | withdrawn
// (staff) | lapsed (the revision left the table: a later one was issued, or
// staff accepted or rejected one by hand). One pending per revision. What is
// shown to the client is fixed when it is asked (the amounts, the options
// proposed, the linked changes, the general PDF); the answer is written once, with the move from
// pending, and never changed. No IP address, no device.
export const budgetApprovals = pgTable(
  "budget_approvals",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    revisionId: text("revision_id").notNull(),
    status: text("status").$type<(typeof COLUMN_VALUES.budgetApprovalStatus)[number]>().default("pending").notNull(),
    // The client it was asked of; only they may answer it.
    clientUserId: text("client_user_id").references(() => users.id, { onDelete: "set null" }),
    // The builder's words to the client.
    message: text("message"),
    // The options proposed as chosen: what the acceptance would record.
    chosenOptionIds: jsonb("chosen_option_ids").$type<string[]>().default([]).notNull(),
    // The changes (CAM-) the revision prices, copied as the client was shown
    // them when asked: editing a change afterwards never alters what was asked
    // or approved.
    changes: jsonb("changes").$type<ApprovalChange[]>().default([]).notNull(),
    // The revision's general PDF, as the client was shown it.
    documentId: text("document_id").references(() => projectDocuments.id, { onDelete: "set null" }),
    // The contract price before (the accepted revision) and after (this one with
    // the options proposed), at the client's price without VAT, and the VAT rate.
    beforeCents: integer("before_cents").notNull(),
    afterCents: integer("after_cents").notNull(),
    vatRateBp: integer("vat_rate_bp").notNull(),
    askedById: text("asked_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    // The client's answer (approved | rejected).
    decidedById: text("decided_by_id").references(() => users.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { mode: "date" }),
    rejectReason: text("reject_reason"),
    // Withdrawn or lapsed: when, and the staff user whose act closed it.
    closedById: text("closed_by_id").references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { mode: "date" }),
  },
  (table) => ({
    oneOpen: uniqueIndex("budget_approvals_one_open")
      .on(table.revisionId)
      .where(sql`${table.status} = 'pending'`),
    projectIdx: index("budget_approvals_project_idx").on(table.projectId),
    projectFk: underProject("budget_approvals_project_id_tenant_fk", table),
    // Never cascaded: an issued revision is never deleted, and this is its evidence.
    revisionFk: foreignKey({
      name: "budget_approvals_revision_id_tenant_fk",
      columns: [table.tenantId, table.revisionId],
      foreignColumns: [budgetRevisions.tenantId, budgetRevisions.id],
    }),
    statusCheck: oneOf("budget_approvals_status_check", table.status, COLUMN_VALUES.budgetApprovalStatus),
    vatRateCheck: basisPoints("budget_approvals_vat_rate_bp_check", table.vatRateBp),
    // Answered only by the client (when, and a reason to reject); closed only by staff.
    decidedCheck: check(
      "budget_approvals_decided_check",
      sql`(${table.decidedAt} is not null) = (${table.status} in ('approved', 'rejected'))
        and (${table.rejectReason} is not null) = (${table.status} = 'rejected')
        and (${table.closedAt} is not null) = (${table.status} in ('withdrawn', 'lapsed'))`,
    ),
  }),
);
