// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

import type { PageQuery, Paging } from "../paging";
import type { CompanyStatus, CompanyStatusResult, DocState, DocStatus, PreventionMode, Region, RequirementId, SubcontractorKind, WorkerAccess } from "../subcontractor-rules";

// ─── Subcontratas ─────────────────────────────────────────────────────────────
// Companies working on the tenant's obras, their workers and CAE documents
// (packages/core/src/subcontractors.ts). Staff only.

/** Error codes of the subcontractors service (`{ error: code }` in the API). */
export type SubcontractorError =
  | "missing_fields"
  | "missing_dates"
  | "missing_reason"
  | "invalid_tax_id"
  | "invalid_id_document"
  | "invalid_postal_code"
  | "invalid_email"
  | "invalid_phone"
  | "invalid_date"
  | "invalid_number"
  | "invalid_option"
  | "invalid_requirement"
  | "invalid_chapter"
  | "permanent_exceeds_headcount"
  | "self_employed_cannot_subcontract"
  | "chain_too_deep"
  | "supplies_only"
  | "tax_id_exists"
  | "id_document_exists"
  | "not_optional"
  | "nothing_to_review"
  | "missing_file"
  | "file_too_large"
  | "invalid_file_type"
  | "project_not_found"
  | "worker_not_found"
  | "not_found"
  | "forbidden";

/** One version (uploaded file) of a document. Dates YYYY-MM-DD, timestamps ISO. */
export type SubcontractorDocVersion = {
  id: string;
  version: number;
  filename: string;
  sizeBytes: number;
  issuedAt: string | null;
  expiresAt: string | null;
  uploadedBy: string | null;
  uploadedAt: string;
  outcome: "validated" | "rejected" | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  rejectReason: string | null;
};

/** A required document as it stands: `id` is null while nothing was ever asked or uploaded. */
export type SubcontractorDoc = {
  id: string | null;
  requirementId: RequirementId;
  workerId: string | null;
  projectId: string | null;
  status: DocStatus | null;
  state: DocState;
  daysLeft: number | null;
  issuedAt: string | null;
  expiresAt: string | null;
  notApplicableReason: string | null;
  requestedAt: string | null;
  /** The current version and who reviewed it. */
  current: SubcontractorDocVersion | null;
  /** Every version, newest first (only on a company's or worker's own page). */
  versions: SubcontractorDocVersion[];
};

/** The documents the Empresas table shows a column for. */
export const DOC_PILLARS = ["rea", "aeat", "ss", "rc", "prl"] as const;
export type DocPillar = (typeof DOC_PILLARS)[number];

export type DocBadge = { state: DocState; daysLeft: number | null };

export type SubcontractorListItem = {
  id: string;
  kind: SubcontractorKind;
  legalName: string;
  taxIdMasked: string;
  reaRegion: Region;
  trades: string[];
  status: CompanyStatus;
  /** A material supplier: no CAE (its status is always apta). */
  suppliesOnly: boolean;
  pillars: Record<DocPillar, DocBadge>;
  /** Mandatory company documents valid, of how many. */
  docsValid: number;
  docsTotal: number;
  workers: number;
  projectIds: string[];
};

/** Something on the Empresas page that needs doing: a document, or a company's missing ones. */
export type AttentionItem = {
  subcontractorId: string;
  subcontractorName: string;
  workerId: string | null;
  workerName: string | null;
  projectId: string | null;
  projectRef: string | null;
  documentId: string | null;
  /** One document, or every missing mandatory one of a company (`state` "missing"). */
  requirementIds: RequirementId[];
  state: DocState;
  daysLeft: number | null;
  /** Expiry, upload or request date, whichever the state is about. */
  date: string | null;
  /** Workers who lose access over it (expired company documents). */
  affectedWorkers: number;
};

export type SubcontractorsOverview = {
  companies: SubcontractorListItem[];
  counts: Record<CompanyStatus, number>;
  workers: { total: number; ok: number; pending: number; blocked: number };
  /** Documents (of companies, workers and obras) expiring within their alert window, and expired. */
  expiring: number;
  expired: number;
  /** Companies working today on obras in execution, and their workers with access there. */
  onSiteToday: { projectRefs: string[]; companies: number; workers: number; blocked: string[] };
  attention: AttentionItem[];
  projects: ProjectOption[];
};

/** The rail's badges. */
export type SubcontractorCounts = { companies: number; workers: number; expiries: number };

/** An obra a company can be assigned to, with the chapters of its budget. */
export type ProjectOption = {
  id: string;
  ref: string;
  address: string;
  obraStage: number;
  chapters: { code: string; name: string }[];
};

export type SubcontractorAssignment = {
  projectId: string;
  projectRef: string;
  projectAddress: string;
  chapterCodes: string[];
  plannedStart: string | null;
  plannedEnd: string | null;
  bookOrder: number | null;
  bookDate: string | null;
  cssInformed: boolean;
  pssAdhesion: SubcontractorDoc;
  /** Its workers' access on this obra. */
  workers: { ok: number; pending: number; blocked: number };
};

export type SubcontractorAuditEntry = {
  id: string;
  at: string;
  action: string;
  userName: string | null;
  workerName: string | null;
  detail: Record<string, unknown>;
};

/** Editable company fields, as a create/update body takes them. */
export type SubcontractorFields = {
  kind: SubcontractorKind;
  legalName: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  province: string;
  reaNumber: string | null;
  phone: string | null;
  email: string | null;
  legalRep: string | null;
  siteContact: string | null;
  siteContactPhone: string | null;
  trades: string[];
  isInstaller: boolean;
  installerReg: string | null;
  headcount: number | null;
  permanentCount: number | null;
  subcontractsFurther: boolean;
  chainLevel: number;
  preventionMode: PreventionMode | null;
  preventionEntity: string | null;
  preventionValidUntil: string | null;
  machinery: string[];
  /** A material supplier: it only delivers, so no CAE documents, workers or obra assignments. */
  suppliesOnly: boolean;
};

/** `taxId` is in full for admins and managers, masked for viewers. */
export type SubcontractorDetail = SubcontractorFields & {
  id: string;
  reaRegion: Region;
  status: CompanyStatusResult;
  lowPermanentShare: boolean | null;
  /** Its own documents: the mandatory ones, then the optional ones. */
  documents: SubcontractorDoc[];
  assignments: SubcontractorAssignment[];
  workers: WorkerListItem[];
  history: SubcontractorAuditEntry[];
  canManage: boolean;
};

export type WorkerListItem = {
  id: string;
  subcontractorId: string;
  subcontractorName: string;
  subcontractorKind: SubcontractorKind;
  firstName: string;
  surnames: string;
  idDocumentMasked: string;
  trade: string | null;
  category: string | null;
  roles: string[];
  /** Each of the worker's documents' state. */
  docs: Partial<Record<RequirementId, DocBadge>>;
  access: WorkerAccess;
};

export const WORKER_ACCESS_FILTERS = ["all", "ok", "pending", "blocked"] as const;
export type WorkerAccessFilter = (typeof WORKER_ACCESS_FILTERS)[number];

/** What narrows the workers list (never its summary), as a URL carries it. */
export type WorkerListQuery = PageQuery & {
  /** Access on this obra (and only its companies' workers); else anywhere. */
  projectId?: unknown;
  companyId?: unknown;
  /** all (default) | ok | pending | blocked */
  access?: unknown;
  /** Text in their name or their company's. */
  q?: unknown;
};

/**
 * GET /api/v1/subcontractors/workers with `?page=` / `?limit=`: one page of
 * the workers the filters keep (`?access`, `?companyId`, `?q`), by surname.
 * The summary is that of every worker (of the obra, with `?projectId`).
 */
export type WorkersPage = {
  workers: WorkerListItem[];
  paging: Paging;
  /** How many workers the company and text filters keep, by access (whatever access is asked for). */
  counts: Record<WorkerAccessFilter, number>;
  summary: { registered: number; companies: number; ok: number; pending: number; blocked: number; preventive: number };
};

/** Editable worker fields. */
export type WorkerFields = {
  subcontractorId: string;
  firstName: string;
  surnames: string;
  idDocument: string;
  phone: string | null;
  category: string | null;
  trade: string | null;
  ssNumber: string | null;
  contractType: string | null;
  startDate: string | null;
  tpcNumber: string | null;
  roles: string[];
  ppeItems: string[];
};

/** An obra a worker's company is on, with what the access rules need of it. */
export type WorkerObra = {
  projectId: string;
  projectRef: string;
  chapterCodes: string[];
  pssAdhesion: { status: DocStatus; expiresAt: string | null } | null;
  bookEntry: boolean;
  access: WorkerAccess;
};

/** `idDocument` is in full for admins and managers, masked for viewers. */
export type WorkerDetail = WorkerFields & {
  id: string;
  subcontractorName: string;
  subcontractorKind: SubcontractorKind;
  companyStatus: CompanyStatus;
  documents: SubcontractorDoc[];
  /** Access anywhere (company and own documents), then on each of the company's obras. */
  access: WorkerAccess;
  obras: WorkerObra[];
  canManage: boolean;
};

/** "Comprobar acceso": who a DNI/NIE or TPC number belongs to and whether they may enter. */
export type AccessCheckResult = {
  worker: { id: string; name: string; subcontractorName: string } | null;
  access: WorkerAccess | null;
};
