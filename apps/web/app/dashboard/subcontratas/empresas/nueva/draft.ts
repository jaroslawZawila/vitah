import {
  MANDATORY_COMPANY_REQUIREMENTS,
  requirement,
  type ProjectOption,
} from "@repo/core/contract";
import type { StepProps } from "../../../components/wizard/types";
import {
  EMPTY_ASSIGNMENT,
  EMPTY_COMPANY_DRAFT,
  assignmentDatesValid,
  type AssignmentValues,
  type CompanyFormDraft,
} from "../../components/fields/draft";

// Everything the Registrar empresa flow collects. The company, its obra and
// its "No aplica" go to the server in one call; the files stay in the browser
// until the company exists, then go up one request each.

export type DocumentDraft = {
  file: File | null;
  /** YYYY-MM-DD, or "". */
  issuedAt: string;
  expiresAt: string;
  /** Optional documents only. */
  notApplicable: boolean;
  reason: string;
};

export type ObraDraft = AssignmentValues & {
  /** "" for no obra yet. */
  projectId: string;
  /** The signed adhesion to the obra's Plan de Seguridad y Salud. */
  pssFile: File | null;
};

export type CompanyFlowDraft = CompanyFormDraft & {
  documents: Record<string, DocumentDraft>;
  obra: ObraDraft;
};

export const EMPTY_DOCUMENT: DocumentDraft = { file: null, issuedAt: "", expiresAt: "", notApplicable: false, reason: "" };

export const EMPTY_OBRA: ObraDraft = { ...EMPTY_ASSIGNMENT, projectId: "", pssFile: null };

export const EMPTY_COMPANY_FLOW: CompanyFlowDraft = { ...EMPTY_COMPANY_DRAFT, documents: {}, obra: EMPTY_OBRA };

/** Data loaded on the server for the flow's steps. */
export type CompanyFlowOptions = { projects: ProjectOption[] };

export type CompanyStepProps = StepProps<CompanyFlowDraft, CompanyFlowOptions>;

export const documentDraft = (draft: CompanyFlowDraft, id: string) => draft.documents[id] ?? EMPTY_DOCUMENT;

/** Mandatory documents with a file chosen. */
export const mandatoryChosen = (draft: CompanyFlowDraft) =>
  MANDATORY_COMPANY_REQUIREMENTS.filter((r) => documentDraft(draft, r.id).file).length;

/**
 * Every chosen file that expires has a date to work the expiry out from, and
 * every "No aplica" a reason.
 */
export function documentsComplete(draft: CompanyFlowDraft) {
  return Object.entries(draft.documents).every(([id, doc]) => {
    if (doc.notApplicable) return doc.reason.trim() !== "";
    if (!doc.file || !requirement(id)?.validityMonths) return true;
    return doc.issuedAt !== "" || doc.expiresAt !== "";
  });
}

export const obraComplete = ({ obra }: CompanyFlowDraft) => !obra.projectId || assignmentDatesValid(obra);

/**
 * The body for createSubcontractorAction: the company's fields, the obra it
 * starts on and the optional documents that don't apply, all in one call.
 */
export function createInput(draft: CompanyFlowDraft) {
  const { documents, obra, ...fields } = draft;
  // The PSS adhesion is a file: it goes up after, with the others.
  const assignment = { ...obra, pssFile: undefined };
  return {
    ...fields,
    ...(obra.projectId ? { assignment } : {}),
    notApplicable: Object.entries(documents)
      .filter(([, doc]) => doc.notApplicable)
      .map(([requirementId, doc]) => ({ requirementId, reason: doc.reason })),
  };
}

export type Upload = { requirementId: string; file: File; issuedAt: string; expiresAt: string; projectId?: string };

/** The files to upload once the company exists, one request each (a function body is limited to 4.5 MB). */
export function uploadsOf(draft: CompanyFlowDraft): Upload[] {
  const uploads: Upload[] = Object.entries(draft.documents)
    .filter(([, doc]) => doc.file && !doc.notApplicable)
    .map(([requirementId, doc]) => ({ requirementId, file: doc.file!, issuedAt: doc.issuedAt, expiresAt: doc.expiresAt }));
  const { projectId, pssFile } = draft.obra;
  if (projectId && pssFile) uploads.push({ requirementId: "adhesion_pss", file: pssFile, issuedAt: "", expiresAt: "", projectId });
  return uploads;
}
