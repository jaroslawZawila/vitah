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
  // Project enums
  projectPhaseEnum,
  projectTypeEnum,
  milestoneStatusEnum,
  taskStatusEnum,
  taskPriorityEnum,
  orderStatusEnum,
  invoiceStatusEnum,
  qcResultEnum,
  documentCategoryEnum,
  // Project tables
  projects,
  projectMilestones,
  projectQualityChecks,
  projectTasks,
  projectMaterialOrders,
  projectInvoices,
  projectDocuments,
  projectActivityLog,
} from "./schema";
export { eq, ne, and, desc, asc, sql, count, sum, inArray, type SQL } from "drizzle-orm";

