import type { WizardStep } from "../../../../components/wizard/types";
import { activityComplete, companyDataComplete } from "../../../components/fields/draft";
import { documentsComplete, obraComplete, type CompanyFlowDraft, type CompanyFlowOptions } from "../draft";
import { ActivityStep, ActivitySummary } from "./ActivityStep";
import { DataStep, DataSummary } from "./DataStep";
import { DocumentsStep, DocumentsSummary } from "./DocumentsStep";
import { ObraStep, ObraSummary } from "./ObraStep";

// The Registrar empresa flow, in order; the review screen follows the last
// step. Titles live under subcontractors.wizard.steps in messages.
export const COMPANY_STEPS: readonly WizardStep<CompanyFlowDraft, CompanyFlowOptions>[] = [
  {
    id: "data",
    titleKey: "data",
    Component: DataStep,
    Summary: DataSummary,
    isComplete: companyDataComplete,
    errorCodes: ["missing_fields", "invalid_tax_id", "invalid_postal_code", "invalid_email", "invalid_phone", "tax_id_exists"],
  },
  {
    id: "activity",
    titleKey: "activity",
    Component: ActivityStep,
    Summary: ActivitySummary,
    isComplete: activityComplete,
    errorCodes: [
      "permanent_exceeds_headcount",
      "self_employed_cannot_subcontract",
      "chain_too_deep",
      "invalid_number",
      "invalid_option",
      "invalid_date",
    ],
  },
  {
    id: "documents",
    titleKey: "documents",
    Component: DocumentsStep,
    Summary: DocumentsSummary,
    isComplete: documentsComplete,
    errorCodes: ["not_optional", "missing_reason", "invalid_requirement"],
    // A material supplier has no CAE documents.
    when: (_, draft) => !draft.suppliesOnly,
  },
  {
    id: "obra",
    titleKey: "obra",
    Component: ObraStep,
    Summary: ObraSummary,
    // Optional: the company can be put on an obra later from its ficha.
    isComplete: obraComplete,
    errorCodes: ["project_not_found", "invalid_chapter"],
    // Nor does it work on an obra.
    when: (_, draft) => !draft.suppliesOnly,
  },
];

