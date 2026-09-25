import { eq, ne, relations, sql } from "drizzle-orm";
import {
  boolean,
  date,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// --- Enums ---

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "manager",
  "viewer",
  // Homeowner using the mobile app. Cannot sign in to the portal.
  "client",
]);

export type UserRole = (typeof userRoleEnum.enumValues)[number];
export type StaffRole = Exclude<UserRole, "client">;
export const STAFF_ROLES = userRoleEnum.enumValues.filter(
  (role): role is StaffRole => role !== "client",
);

// --- Tenants ---

export const tenants = pgTable("tenants", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  name: text("name").notNull(),
  slug: text("slug").unique().notNull(),
  active: boolean("active").default(true).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

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
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    tenantEmailUnique: unique("users_tenant_email_unique").on(table.tenantId, table.email),
    // Mobile login looks clients up by email alone, so client emails must be
    // unique across tenants.
    clientEmailUnique: uniqueIndex("users_client_email_unique")
      .on(table.email)
      .where(sql`${table.role} = 'client'`),
  }),
);

// --- Client profiles ---

// Personal details of a mobile-app client (a `users` row with role "client").
// Login data (email, password) stays on `users`.
export const clientProfiles = pgTable("client_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
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
});

/** SQL filters splitting portal staff from mobile-app clients. */
export const isClientUser = eq(users.role, "client");
export const isStaffUser = ne(users.role, "client");

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

// --- Projects ---

export const projects = pgTable(
  "projects",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    ref: text("ref").notNull(),
    // Full address of the home.
    address: text("address").notNull(),
    startDate: timestamp("start_date", { mode: "date" }),
    completionDate: timestamp("completion_date", { mode: "date" }),
    // Homeowner with mobile app access. At most one project per client.
    clientUserId: text("client_user_id")
      .unique("projects_client_user_unique")
      .references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
  },
  (table) => ({
    tenantRefUnique: unique("projects_tenant_ref_unique").on(
      table.tenantId,
      table.ref,
    ),
  }),
);

// --- Relations ---

export const tenantsRelations = relations(tenants, ({ many }) => ({
  users: many(users),
  projects: many(projects),
}));

export const usersRelations = relations(users, ({ one }) => ({
  tenant: one(tenants, {
    fields: [users.tenantId],
    references: [tenants.id],
  }),
  clientProfile: one(clientProfiles),
}));

export const clientProfilesRelations = relations(clientProfiles, ({ one }) => ({
  user: one(users, {
    fields: [clientProfiles.userId],
    references: [users.id],
  }),
}));

export const projectsRelations = relations(projects, ({ one }) => ({
  tenant: one(tenants, {
    fields: [projects.tenantId],
    references: [tenants.id],
  }),
  client: one(users, {
    fields: [projects.clientUserId],
    references: [users.id],
  }),
}));
