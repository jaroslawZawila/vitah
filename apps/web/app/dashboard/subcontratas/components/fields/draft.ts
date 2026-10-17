import {
  isValidCif,
  isValidPersonalId,
  lowPermanentShare,
  normalizeIdNumber,
  provinceForPostalCode,
  type SubcontractorFields,
  type SubcontractorKind,
} from "@repo/core/contract";

// The company form's values, as the inputs hold them (numbers and dates as
// text, "" for empty). Core parses this shape directly, so the draft is sent
// to createSubcontractorAction / updateSubcontractorAction as it is.

export type CompanyFormDraft = {
  kind: SubcontractorKind;
  legalName: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  province: string;
  reaNumber: string;
  phone: string;
  email: string;
  legalRep: string;
  siteContact: string;
  siteContactPhone: string;
  trades: string[];
  isInstaller: boolean;
  installerReg: string;
  headcount: string;
  permanentCount: string;
  subcontractsFurther: boolean;
  chainLevel: string;
  preventionMode: string;
  preventionEntity: string;
  preventionValidUntil: string;
  machinery: string[];
};

export const EMPTY_COMPANY_DRAFT: CompanyFormDraft = {
  kind: "company",
  legalName: "",
  taxId: "",
  address: "",
  postalCode: "",
  city: "",
  province: "",
  reaNumber: "",
  phone: "",
  email: "",
  legalRep: "",
  siteContact: "",
  siteContactPhone: "",
  trades: [],
  isInstaller: false,
  installerReg: "",
  headcount: "",
  permanentCount: "",
  subcontractsFurther: false,
  chainLevel: "1",
  preventionMode: "",
  preventionEntity: "",
  preventionValidUntil: "",
  machinery: [],
};

/** An existing company's fields (from any object holding them, e.g. its detail) as form values. */
export function companyDraftFrom(company: SubcontractorFields): CompanyFormDraft {
  const draft: Record<string, unknown> = {};
  for (const [key, empty] of Object.entries(EMPTY_COMPANY_DRAFT)) {
    const value = company[key as keyof SubcontractorFields];
    draft[key] = typeof empty === "string" ? (value === null ? "" : String(value)) : value;
  }
  return draft as CompanyFormDraft;
}

/** `list` with `value` added, or taken out if it was there. */
export const toggle = <T>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

/** A company's work on an obra, as the inputs hold it ("" for empty). Core parses it as it is. */
export type AssignmentValues = {
  chapterCodes: string[];
  plannedStart: string;
  plannedEnd: string;
  bookOrder: string;
  bookDate: string;
  cssInformed: boolean;
};

export const EMPTY_ASSIGNMENT: AssignmentValues = {
  chapterCodes: [],
  plannedStart: "",
  plannedEnd: "",
  bookOrder: "",
  bookDate: "",
  cssInformed: false,
};

/** Whether the planned dates are in order (or not both given). */
export const assignmentDatesValid = ({ plannedStart, plannedEnd }: AssignmentValues) =>
  !(plannedStart && plannedEnd && plannedEnd < plannedStart);

/** Whether the CIF (company) or NIF (self-employed) passes its check character; null while empty. */
export function taxIdValid(draft: Pick<CompanyFormDraft, "kind" | "taxId">): boolean | null {
  const id = normalizeIdNumber(draft.taxId);
  if (!id) return null;
  return draft.kind === "company" ? isValidCif(id) : isValidPersonalId(id);
}

const numberOrNull = (value: string) => (value.trim() === "" ? null : Number(value));

/** The Ley 32/2006 30 % warning: true when under it, null when unknown. */
export const permanentShareLow = (draft: CompanyFormDraft) =>
  lowPermanentShare(numberOrNull(draft.headcount), numberOrNull(draft.permanentCount));

export const permanentExceedsHeadcount = (draft: CompanyFormDraft) => {
  const headcount = numberOrNull(draft.headcount);
  const permanent = numberOrNull(draft.permanentCount);
  return headcount !== null && permanent !== null && permanent > headcount;
};

/** Datos de la empresa: everything required is there and checks out. */
export function companyDataComplete(draft: CompanyFormDraft) {
  const required = [draft.legalName, draft.taxId, draft.address, draft.postalCode, draft.city];
  return (
    required.every((value) => value.trim() !== "") &&
    taxIdValid(draft) === true &&
    provinceForPostalCode(draft.postalCode.trim()) !== null
  );
}

/** Actividad y prevención: nothing the law or core would refuse. */
export function activityComplete(draft: CompanyFormDraft) {
  return !permanentExceedsHeadcount(draft) && !(draft.kind === "self_employed" && draft.subcontractsFurther);
}
