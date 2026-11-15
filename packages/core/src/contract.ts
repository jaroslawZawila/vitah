// Types and constants shared with clients (mobile app, browser components).
// Must not import server-only code: importing this file never pulls in the
// database. The declarations live by domain in ./contract/; this file is the
// public entry (`@repo/core/contract`) and re-exports them all.

export * from "./contract/accounts";
export * from "./contract/clients";
export * from "./contract/files";
export * from "./contract/obra";
export * from "./contract/budget";
export * from "./contract/budget-overview";
export * from "./budget-overview-rules";
export * from "./project-filters";
export { DEFAULT_PAGE_SIZE, MAX_ALL_ROWS, MAX_PAGE_SIZE, MAX_UNPAGED, type PageQuery, type Paging } from "./paging";

export * from "./contract/construction";
export * from "./contract/purchasing";
export * from "./contract/purchase-invoices";
export * from "./contract/purchase-checks";
export * from "./contract/purchase-suppliers";
export * from "./contract/purchase-requests";
export * from "./contract/planning";
export { lateToFinishDays, lateToStartDays, projectSchedule, scheduleStatus, type ScheduleChapterInput } from "./schedule-status";
export * from "./contract/subcontractors";
export * from "./subcontractor-rules";
export * from "./contract/deleted";

// ─── Write inputs ────────────────────────────────────────────────────────────
// What the writes take, inferred from their zod schemas (./inputs). Types only:
// the app and the browser never load zod; core validates every body.
export type {
  InvoiceFileInput,
  OrderMilestonesInput,
  PurchaseInvoiceChangesInput,
  PurchaseInvoiceInput,
  PurchasePaymentInput,
} from "./inputs/purchase-invoices";
export { MAX_AMOUNT_CENTS } from "./money";
export type { AcceptRevisionInput, BudgetChapterChangesInput, BudgetGenerationInput, BudgetLineChangesInput, BudgetOptionChangesInput, BudgetProgressInput, BudgetRevisionChangesInput, IssueRevisionInput, NewBudgetChapterInput, NewBudgetInput, NewBudgetLineInput, NewBudgetOptionInput, OptionFromLineInput, RejectRevisionInput } from "./inputs/budget";
export type { ActaPhotosInput, HitoChangesInput, HitoCheckChangesInput, HitoFileInput, HitoPaymentInput, HitoPlanInput, NewHitoCheckInput } from "./inputs/hitos";
export type { ObraStageInput } from "./inputs/obra";

export type { OrderLinesInput, PurchaseOrderChangesInput, PurchaseOrderInput, PurchaseStatusInput } from "./inputs/purchasing";
export type { PurchaseRequestCancelInput, PurchaseRequestChangesInput, PurchaseRequestDecisionInput, PurchaseRequestInput } from "./inputs/purchase-requests";
export type { PurchaseAmendmentInput } from "./inputs/purchase-amendments";
export type { OrderDocumentInput, OrderDocumentVersionInput } from "./inputs/purchase-documents";
export type { ChapterCorrectionInput, ChapterDateInput, ObraIssueChangesInput, ObraIssueInput } from "./inputs/construction";
export type { PlanningApproveInput, PlanningDraftInput, PlanningDraftNewInput, PlanningRuleInput } from "./inputs/planning";

export type { MeChangesInput, MfaCodeInput, MfaDisableInput, MobileSignInInput, PasswordChangeInput, PasswordInput, StaffUserChangesInput, StaffUserInput } from "./inputs/accounts";
export type { ClientErrorReportInput, ClientInput, ClientSettingsInput, ProjectClientInput, PushTokenInput, PushTokenRemovalInput } from "./inputs/clients";
export type { BudgetInputRegistrationInput, ProjectChangesInput, ProjectDocumentInput, ProjectInput, ProjectPhotoInput, VisibilityInput } from "./inputs/projects";
export type { AccessCheckInput, AssignmentInput, DocumentRejectionInput, DocumentRequestInput, NotApplicableInput, SubcontractorChangesInput, SubcontractorDocumentInput, SubcontractorInput, WorkerChangesInput, WorkerInput } from "./inputs/subcontractors";
