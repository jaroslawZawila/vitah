// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { and, eq, ne, sql } from "drizzle-orm";
import { boolean, date, foreignKey, index, integer, jsonb, pgTable, text, timestamp, unique, uniqueIndex } from "drizzle-orm/pg-core";
import { COLUMN_VALUES, notNegative, oneOf } from "./checks";
import { userRoleEnum } from "./enums";
import { tenants } from "./tenants";

// --- Users ---

export const users = pgTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name"),
    email: text("email").notNull(),
    emailVerified: timestamp("email_verified", { mode: "date" }),
    image: text("image"),
    passwordHash: text("password_hash"),
    role: userRoleEnum("role").default("viewer").notNull(),
    active: boolean("active").default(true).notNull(),
    // The portal's language for staff ("es" | "en"), picked in the rail; null
    // follows the browser. The mobile app keeps its own, on the phone.
    language: text("language").$type<(typeof COLUMN_VALUES.language)[number]>(),
    // Mobile tokens issued before this are revoked (password changed or reset).
    passwordChangedAt: timestamp("password_changed_at", { mode: "date" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    tenantEmailUnique: unique("users_tenant_email_unique").on(table.tenantId, table.email),
    // Logins look users up by email alone (clients on mobile, staff on the
    // portal), so an email is unique across tenants within each audience.
    clientEmailUnique: uniqueIndex("users_client_email_unique")
      .on(table.email)
      .where(sql`${table.role} = 'client'`),
    staffEmailUnique: uniqueIndex("users_staff_email_unique")
      .on(sql`lower(${table.email})`)
      .where(sql`${table.role} <> 'client'`),
    // What the rows that carry a user's tenant reference: (tenant_id, user_id).
    tenantIdUnique: unique("users_id_tenant_id_unique").on(table.id, table.tenantId),
    languageCheck: oneOf("users_language_check", table.language, COLUMN_VALUES.language),
  }),
);

// --- Login throttling ---

// Failed sign-ins per key (an email or an IP) in the current window; see
// packages/core/src/throttle.ts. Not tenant data: a key may match no user.
export const loginAttempts = pgTable(
  "login_attempts",
  {
    key: text("key").primaryKey(),
    failures: integer("failures").default(0).notNull(),
    windowStart: timestamp("window_start", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    failuresCheck: notNegative("login_attempts_failures_check", table.failures),
  }),
);

// --- Two-step verification (TOTP) ---

/** One recovery code as stored: its salt and SHA-256, never the code; `usedAt` (ISO) once it was spent. */
export type MfaRecoveryCode = { salt: string; hash: string; usedAt: string | null };

// A staff user's authenticator (packages/core/src/mfa.ts). The row exists from
// the moment they start enrolling; it only gates sign-in once `confirmed_at`
// is set. `secret` is the TOTP key encrypted at rest (mfa-secret.ts), never
// the key itself. `last_step` is the last 30-second step a code was accepted
// for: the same code is refused a second time.
export const userMfa = pgTable(
  "user_mfa",
  {
    userId: text("user_id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    confirmedAt: timestamp("confirmed_at", { mode: "date" }),
    recoveryCodes: jsonb("recovery_codes").$type<MfaRecoveryCode[]>().default([]).notNull(),
    lastStep: integer("last_step"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    userFk: foreignKey({
      name: "user_mfa_user_id_tenant_fk",
      columns: [table.tenantId, table.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete("cascade"),
  }),
);

// --- Client profiles ---

// Personal details of a mobile-app client (a `users` row with role "client").
// Login data (email, password) stays on `users`.
export const clientProfiles = pgTable(
  "client_profiles",
  {
    userId: text("user_id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    firstName: text("first_name").notNull(),
    surnames: text("surnames").notNull(),
    // Calendar date, YYYY-MM-DD.
    dateOfBirth: date("date_of_birth", { mode: "string" }),
    address: text("address"),
    phone: text("phone"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    userFk: foreignKey({
      name: "client_profiles_user_id_tenant_fk",
      columns: [table.tenantId, table.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete("cascade"),
  }),
);

// --- Client app settings ---

// A mobile-app client's notification choices, set from the app's Perfil tab.
// No row means the defaults (DEFAULT_SETTINGS in @repo/core): all on.
export const clientSettings = pgTable(
  "client_settings",
  {
    userId: text("user_id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    notifyProgress: boolean("notify_progress").default(true).notNull(),
    notifyDocuments: boolean("notify_documents").default(true).notNull(),
    notifyMessages: boolean("notify_messages").default(true).notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    userFk: foreignKey({
      name: "client_settings_user_id_tenant_fk",
      columns: [table.tenantId, table.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete("cascade"),
  }),
);

// An Expo push token of a phone signed in to the app. A phone belongs to
// whoever signed in on it last, so the token itself is the key. `language`
// is the phone's app language ("es" | "en"): pushes are written in it.
export const pushTokens = pgTable(
  "push_tokens",
  {
    token: text("token").primaryKey(),
    language: text("language").default("es").notNull(),
    userId: text("user_id").notNull(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    userIdx: index("push_tokens_user_idx").on(table.userId),
    userFk: foreignKey({
      name: "push_tokens_user_id_tenant_fk",
      columns: [table.tenantId, table.userId],
      foreignColumns: [users.tenantId, users.id],
    }).onDelete("cascade"),
    languageCheck: oneOf("push_tokens_language_check", table.language, COLUMN_VALUES.language),
  }),
);

/** SQL filters splitting portal staff from mobile-app clients. */
export const isClientUser = eq(users.role, "client");
export const isStaffUser = ne(users.role, "client");

/** The staff member with this (lower-cased) email, in any tenant: matches `users_staff_email_unique`. */
export const staffWithEmail = (email: string) =>
  and(sql`lower(${users.email}) = ${email}`, isStaffUser);

// --- NextAuth adapter tables (for future OAuth / DB sessions) ---

export const accounts = pgTable("accounts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("provider_account_id").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
});

export const sessions = pgTable("sessions", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  sessionToken: text("session_token").unique().notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});

export const verificationTokens = pgTable("verification_tokens", {
  identifier: text("identifier").notNull(),
  token: text("token").notNull(),
  expires: timestamp("expires", { mode: "date" }).notNull(),
});
