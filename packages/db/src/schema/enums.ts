// Part of @repo/db/schema (../schema.ts re-exports it; drizzle-kit reads the tables from there).

import { pgEnum } from "drizzle-orm/pg-core";

// --- Enums ---

export const userRoleEnum = pgEnum("user_role", [
  "admin",
  "manager",
  "viewer",
  // Homeowner using the mobile app. Cannot sign in to the portal.
  "client",
]);

export type UserRole = (typeof userRoleEnum.enumValues)[number];

export const documentCategoryEnum = pgEnum("document_category", [
  "contract",
  "plans",
  "certificates",
  "other",
  // The budget's input documents and its PDFs (features/budget/TECH_DESIGN.md §3.4).
  "budget",
]);
export type StaffRole = Exclude<UserRole, "client">;

// A budget revision is drafted, issued to the client (frozen, with its PDFs),
// then accepted (it becomes the contract) or rejected; it is superseded when a
// later revision is accepted.
export const budgetRevisionStatusEnum = pgEnum("budget_revision_status", [
  "draft",
  "accepted",
  "superseded",
  "issued",
  "rejected",
]);
export const STAFF_ROLES = userRoleEnum.enumValues.filter(
  (role): role is StaffRole => role !== "client",
);
