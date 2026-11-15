// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { sql } from "drizzle-orm";
import { bigint, check, index, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { budgetRevisions } from "./budget";
import { COLUMN_RANGES, COLUMN_VALUES, oneOf, within } from "./checks";
import { projects } from "./projects";
import { tenants } from "./tenants";
import { underProject } from "./under-project";
import { users } from "./users";

// --- Budget: AI generation ---

// One run of the AI that drafts a project's first budget from its documents
// (core budget-ai/pipeline.ts, run as a Vercel Workflow).
export const budgetGenerations = pgTable(
  "budget_generations",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    // queued | running | succeeded | failed | cancelled
    status: text("status").$type<(typeof COLUMN_VALUES.budgetGenerationStatus)[number]>().notNull(),
    // 0–5, for the progress bar.
    step: integer("step").default(0).notNull(),
    // [{ at, step, kind: info | done | error, text }]
    log: jsonb("log").default([]).notNull(),
    // { reference, quality, vatRateBp }
    options: jsonb("options").notNull(),
    documentIds: text("document_ids").array().notNull(),
    // Step 1's result: the project as the AI read it.
    extracted: jsonb("extracted"),
    // The pipeline's working data: the inputs as sent to Claude and steps 2–5's
    // results by group, so a retried step picks up where it was.
    state: jsonb("state").default({}).notNull(),
    revisionId: text("revision_id").references(() => budgetRevisions.id, { onDelete: "set null" }),
    workflowRunId: text("workflow_run_id"),
    error: text("error"),
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectIdx: index("budget_generations_project_idx").on(table.projectId),
    projectFk: underProject("budget_generations_project_id_tenant_fk", table),
    statusCheck: oneOf("budget_generations_status_check", table.status, COLUMN_VALUES.budgetGenerationStatus),
    stepCheck: within("budget_generations_step_check", table.step, COLUMN_RANGES.generationStep),
  }),
);

// One Claude API call: tokens and cost, for spend tracking per tenant.
export const aiUsage = pgTable(
  "ai_usage",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "set null" }),
    generationId: text("generation_id").references(() => budgetGenerations.id, { onDelete: "set null" }),
    // budget.extract | budget.group.0 …
    purpose: text("purpose").notNull(),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    cacheReadTokens: integer("cache_read_tokens").default(0).notNull(),
    cacheWriteTokens: integer("cache_write_tokens").default(0).notNull(),
    costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    tenantCreatedIdx: index("ai_usage_tenant_created_idx").on(table.tenantId, table.createdAt),
    countsCheck: check(
      "ai_usage_counts_check",
      sql`${table.inputTokens} >= 0 and ${table.outputTokens} >= 0 and ${table.cacheReadTokens} >= 0 and ${table.cacheWriteTokens} >= 0 and ${table.costMicroUsd} >= 0`,
    ),
  }),
);
