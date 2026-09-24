import { eq, ne, relations, sql } from "drizzle-orm";
import {
  boolean,
  integer,
  jsonb,
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

export const projectPhaseEnum = pgEnum("project_phase", [
  "showroom",
  "budget",
  "technical",
  "review",
  "dossier",
  "logistics",
  "construction",
  "certified",
]);

export const projectTypeEnum = pgEnum("project_type", [
  "unifamiliar",
  "adosado",
  "duplex",
]);

export const milestoneStatusEnum = pgEnum("milestone_status", [
  "pending",
  "in_progress",
  "completed",
]);

export const taskStatusEnum = pgEnum("task_status", [
  "pending",
  "in_process",
  "in_review",
  "completed",
]);

export const taskPriorityEnum = pgEnum("task_priority", [
  "low",
  "medium",
  "high",
]);

export const orderStatusEnum = pgEnum("order_status", [
  "pending",
  "ordered",
  "confirmed",
  "in_transit",
  "delivered",
]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "issued",
  "due_soon",
  "paid",
  "overdue",
]);

export const qcResultEnum = pgEnum("qc_result", [
  "pending",
  "pass",
  "fail",
]);

export const documentCategoryEnum = pgEnum("document_category", [
  "basic_project",
  "construction_plans",
  "licenses",
  "quality_control",
  "photos",
  "certifications",
  "warranties",
  "building_book",
  "insurance",
]);

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
    clientName: text("client_name").notNull(),
    areaM2: integer("area_m2").notNull(),
    type: projectTypeEnum("type").notNull(),
    phase: projectPhaseEnum("phase").default("showroom").notNull(),
    progressPct: integer("progress_pct").default(0).notNull(),
    budgetTotal: integer("budget_total").default(0).notNull(),
    advisorId: text("advisor_id").references(() => users.id, {
      onDelete: "set null",
    }),
    // Full address of the home; shown as "address" in the mobile app.
    location: text("location").notNull(),
    qualityLevel: text("quality_level").default("standard").notNull(),
    constructionWeekCurrent: integer("construction_week_current"),
    constructionWeekTotal: integer("construction_week_total"),
    startDate: timestamp("start_date", { mode: "date" }),
    expectedDeliveryDate: timestamp("expected_delivery_date", { mode: "date" }),
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

// --- Project Milestones (H1–H10) ---

export const projectMilestones = pgTable("project_milestones", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
  status: milestoneStatusEnum("status").default("pending").notNull(),
  completionDate: timestamp("completion_date", { mode: "date" }),
  estimatedDate: timestamp("estimated_date", { mode: "date" }),
  photoCount: integer("photo_count").default(0).notNull(),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// --- Project Quality Checks ---

export const projectQualityChecks = pgTable("project_quality_checks", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  milestoneId: text("milestone_id").references(() => projectMilestones.id, {
    onDelete: "set null",
  }),
  name: text("name").notNull(),
  detail: text("detail").notNull(),
  measuredValue: text("measured_value"),
  result: qcResultEnum("result").default("pending").notNull(),
  checkedAt: timestamp("checked_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// --- Project Tasks ---

export const projectTasks = pgTable("project_tasks", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  department: text("department").notNull(),
  priority: taskPriorityEnum("priority").default("medium").notNull(),
  status: taskStatusEnum("status").default("pending").notNull(),
  assigneeId: text("assignee_id").references(() => users.id, {
    onDelete: "set null",
  }),
  dueDate: timestamp("due_date", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// --- Project Material Orders ---

export const projectMaterialOrders = pgTable("project_material_orders", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  materialDescription: text("material_description").notNull(),
  supplier: text("supplier").notNull(),
  quantity: text("quantity"),
  orderDate: timestamp("order_date", { mode: "date" }),
  eta: timestamp("eta", { mode: "date" }),
  status: orderStatusEnum("status").default("pending").notNull(),
  jitWeek: text("jit_week"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// --- Project Invoices ---

export const projectInvoices = pgTable("project_invoices", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  amount: integer("amount").notNull(),
  description: text("description"),
  dueDate: timestamp("due_date", { mode: "date" }).notNull(),
  status: invoiceStatusEnum("status").default("draft").notNull(),
  paidAt: timestamp("paid_at", { mode: "date" }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// --- Project Documents ---

export const projectDocuments = pgTable("project_documents", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  category: documentCategoryEnum("category").notNull(),
  fileName: text("file_name").notNull(),
  fileUrl: text("file_url").notNull(),
  fileSizeBytes: integer("file_size_bytes"),
  uploadedById: text("uploaded_by_id").references(() => users.id, {
    onDelete: "set null",
  }),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow().notNull(),
});

// --- Project Activity Log ---

export const projectActivityLog = pgTable("project_activity_log", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id, { onDelete: "cascade" }),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  action: text("action").notNull(),
  detail: text("detail"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow().notNull(),
});

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
}));

export const projectsRelations = relations(projects, ({ one, many }) => ({
  tenant: one(tenants, {
    fields: [projects.tenantId],
    references: [tenants.id],
  }),
  advisor: one(users, {
    fields: [projects.advisorId],
    references: [users.id],
  }),
  client: one(users, {
    fields: [projects.clientUserId],
    references: [users.id],
  }),
  milestones: many(projectMilestones),
  qualityChecks: many(projectQualityChecks),
  tasks: many(projectTasks),
  materialOrders: many(projectMaterialOrders),
  invoices: many(projectInvoices),
  documents: many(projectDocuments),
  activityLog: many(projectActivityLog),
}));

export const projectMilestonesRelations = relations(
  projectMilestones,
  ({ one, many }) => ({
    project: one(projects, {
      fields: [projectMilestones.projectId],
      references: [projects.id],
    }),
    qualityChecks: many(projectQualityChecks),
  }),
);

export const projectQualityChecksRelations = relations(
  projectQualityChecks,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectQualityChecks.projectId],
      references: [projects.id],
    }),
    milestone: one(projectMilestones, {
      fields: [projectQualityChecks.milestoneId],
      references: [projectMilestones.id],
    }),
  }),
);

export const projectTasksRelations = relations(projectTasks, ({ one }) => ({
  project: one(projects, {
    fields: [projectTasks.projectId],
    references: [projects.id],
  }),
  assignee: one(users, {
    fields: [projectTasks.assigneeId],
    references: [users.id],
  }),
}));

export const projectMaterialOrdersRelations = relations(
  projectMaterialOrders,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectMaterialOrders.projectId],
      references: [projects.id],
    }),
  }),
);

export const projectInvoicesRelations = relations(
  projectInvoices,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectInvoices.projectId],
      references: [projects.id],
    }),
  }),
);

export const projectDocumentsRelations = relations(
  projectDocuments,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectDocuments.projectId],
      references: [projects.id],
    }),
    uploadedBy: one(users, {
      fields: [projectDocuments.uploadedById],
      references: [users.id],
    }),
  }),
);

export const projectActivityLogRelations = relations(
  projectActivityLog,
  ({ one }) => ({
    project: one(projects, {
      fields: [projectActivityLog.projectId],
      references: [projects.id],
    }),
    user: one(users, {
      fields: [projectActivityLog.userId],
      references: [users.id],
    }),
  }),
);
