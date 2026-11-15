// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { sql } from "drizzle-orm";
import { boolean, check, date, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique } from "drizzle-orm/pg-core";
import { COLUMN_VALUES, notNegative, oneOf } from "./checks";
import { tenants } from "./tenants";
import { underProject } from "./under-project";
import { users } from "./users";

// --- Garantía: after-sales warranty claims ---
// What the client of a handed-over home asks the builder to fix under the LOE
// guarantee, from the app; staff answer it on the project's Garantía tab.
// Nothing here is deleted: the client cancels a claim, staff reject it.

// One claim, numbered per project (GAR-001), written by the client.
export const warrantyClaims = pgTable(
  "warranty_claims",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    projectId: text("project_id").notNull(),
    number: integer("number").notNull(),
    kind: text("kind").$type<(typeof COLUMN_VALUES.warrantyKind)[number]>().notNull(),
    room: text("room").$type<(typeof COLUMN_VALUES.warrantyRoom)[number]>().notNull(),
    description: text("description").notNull(),
    urgent: boolean("urgent").default(false).notNull(),
    // received → in_review → scheduled → resolved, or rejected (staff), or cancelled (the client).
    status: text("status").$type<(typeof COLUMN_VALUES.warrantyStatus)[number]>().default("received").notNull(),
    // The day staff will visit; required while scheduled, kept after.
    visitOn: date("visit_on", { mode: "string" }),
    // The builder's last answer to the client (a rejection's reason).
    answer: text("answer"),
    answeredAt: timestamp("answered_at", { mode: "date" }),
    // The client who wrote it.
    createdById: text("created_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" })
      .defaultNow()
      .notNull()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    projectNumberUnique: unique("warranty_claims_project_number_unique").on(table.projectId, table.number),
    tenantIdUnique: unique("warranty_claims_id_tenant_id_unique").on(table.id, table.tenantId),
    projectCreatedIdx: index("warranty_claims_project_created_idx").on(table.projectId, table.createdAt),
    projectFk: underProject("warranty_claims_project_id_tenant_fk", table),
    kindCheck: oneOf("warranty_claims_kind_check", table.kind, COLUMN_VALUES.warrantyKind),
    roomCheck: oneOf("warranty_claims_room_check", table.room, COLUMN_VALUES.warrantyRoom),
    statusCheck: oneOf("warranty_claims_status_check", table.status, COLUMN_VALUES.warrantyStatus),
    numberCheck: check("warranty_claims_number_check", sql`${table.number} >= 1`),
    // A visit is scheduled for a day; a rejection says why.
    scheduledCheck: check("warranty_claims_scheduled_check", sql`${table.status} <> 'scheduled' or ${table.visitOn} is not null`),
    rejectedCheck: check("warranty_claims_rejected_check", sql`${table.status} <> 'rejected' or ${table.answer} is not null`),
  }),
);

// A claim's photo (JPEG, PNG or WebP, with a WebP thumbnail next to it), from
// the client. Private Blob store, served only through our API.
export const warrantyClaimPhotos = pgTable(
  "warranty_claim_photos",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    claimId: text("claim_id").notNull(),
    pathname: text("pathname").unique().notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    thumbSizeBytes: integer("thumb_size_bytes").notNull(),
    uploadedById: text("uploaded_by_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    claimIdx: index("warranty_claim_photos_claim_idx").on(table.claimId),
    claimFk: foreignKey({
      name: "warranty_claim_photos_claim_id_tenant_fk",
      columns: [table.tenantId, table.claimId],
      foreignColumns: [warrantyClaims.tenantId, warrantyClaims.id],
    }).onDelete("cascade"),
    sizeCheck: notNegative("warranty_claim_photos_size_bytes_check", table.sizeBytes),
    thumbSizeCheck: notNegative("warranty_claim_photos_thumb_size_bytes_check", table.thumbSizeBytes),
  }),
);

// Every step of a claim: created, a photo added, staff's changes (status,
// visit day, answer: `detail` holds each one's before and after), cancelled.
// Append-only. A client's step has the client as its user.
export const warrantyClaimEvents = pgTable(
  "warranty_claim_events",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    claimId: text("claim_id").notNull(),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").$type<(typeof COLUMN_VALUES.warrantyEventAction)[number]>().notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().default({}).notNull(),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    claimCreatedIdx: index("warranty_claim_events_claim_created_idx").on(table.claimId, table.createdAt),
    claimFk: foreignKey({
      name: "warranty_claim_events_claim_id_tenant_fk",
      columns: [table.tenantId, table.claimId],
      foreignColumns: [warrantyClaims.tenantId, warrantyClaims.id],
    }).onDelete("cascade"),
    actionCheck: oneOf("warranty_claim_events_action_check", table.action, COLUMN_VALUES.warrantyEventAction),
  }),
);
