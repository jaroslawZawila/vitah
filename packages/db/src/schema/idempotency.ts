// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { index, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants";
import { users } from "./users";

// --- Idempotency keys ---

// A create its caller may send twice (a double click, a retry after a timeout)
// is applied once: the caller's key, per tenant and operation, with what the
// first call answered; see packages/core/src/idempotency.ts. Written in the
// create's own transaction, so a create that fails keeps no key. Rows older
// than a week are swept away.
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    // Which operation: purchase.payment.create …
    scope: text("scope").notNull(),
    // The caller's key: a UUID, or 16–100 URL-safe characters.
    key: text("key").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    // SHA-256 of the request: the same key with another request is refused.
    requestHash: text("request_hash").notNull(),
    // What the first call returned: a retry is answered with it.
    result: jsonb("result").$type<unknown>(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    pk: primaryKey({ name: "idempotency_keys_pk", columns: [table.tenantId, table.scope, table.key] }),
    createdIdx: index("idempotency_keys_created_idx").on(table.createdAt),
  }),
);
