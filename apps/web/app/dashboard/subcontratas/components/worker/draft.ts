import type { DocFacts, SubcontractorDoc, SubcontractorListItem, WorkerFields } from "@repo/core/contract";

// The worker form's values as the inputs hold them ("" for empty). Core parses
// this shape directly.

export type WorkerFormDraft = {
  subcontractorId: string;
  firstName: string;
  surnames: string;
  idDocument: string;
  phone: string;
  category: string;
  trade: string;
  ssNumber: string;
  contractType: string;
  startDate: string;
  tpcNumber: string;
  roles: string[];
  ppeItems: string[];
};

export const emptyWorkerDraft = (subcontractorId = ""): WorkerFormDraft => ({
  subcontractorId,
  firstName: "",
  surnames: "",
  idDocument: "",
  phone: "",
  category: "",
  trade: "",
  ssNumber: "",
  contractType: "",
  startDate: "",
  tpcNumber: "",
  roles: [],
  ppeItems: [],
});

export function workerDraftFrom(fields: WorkerFields): WorkerFormDraft {
  const text = (value: string | null) => value ?? "";
  return {
    ...fields,
    phone: text(fields.phone),
    category: text(fields.category),
    trade: text(fields.trade),
    ssNumber: text(fields.ssNumber),
    contractType: text(fields.contractType),
    startDate: text(fields.startDate),
    tpcNumber: text(fields.tpcNumber),
  };
}

/** A company to pick in the form, with what the access card needs of it. */
export type CompanyChoice = Pick<SubcontractorListItem, "id" | "legalName" | "kind" | "status">;

/** The worker's documents as the access rules read them. */
export function documentFacts(documents: SubcontractorDoc[]) {
  const facts = new Map<string, DocFacts>();
  for (const doc of documents) if (doc.status) facts.set(doc.requirementId, { status: doc.status, expiresAt: doc.expiresAt });
  return facts;
}
