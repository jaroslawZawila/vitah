export { db } from "./client";
export {
  tenants,
  users,
  accounts,
  sessions,
  verificationTokens,
  userRoleEnum,
  STAFF_ROLES,
  isClientUser,
  isStaffUser,
  type UserRole,
  type StaffRole,
  projects,
  clientProfiles,
  projectDocuments,
  projectPhotos,
  clientSettings,
  pushTokens,
  budgetRevisions,
  budgetChapters,
  budgetLines,
  obraHitos,
  obraHitoChapters,
  obraHitoChecks,
  obraHitoPhotos,
} from "./schema";
export { seedConfig } from "./seed-config";
export type { AnyColumn } from "drizzle-orm";
export type { PgTable } from "drizzle-orm/pg-core";
export { eq, ne, gt, lt, and, or, desc, asc, sql, count, sum, inArray, isNull, isNotNull, max, type SQL } from "drizzle-orm";

