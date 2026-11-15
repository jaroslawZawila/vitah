// The words the database accepts in each text status/kind column
// (@repo/db's COLUMN_VALUES, which its CHECK constraints are built from) are
// the words core's contract offers: a value added on one side only fails here
// (or, for the unions core declares without a list, fails to compile).

import { COLUMN_RANGES, COLUMN_VALUES, STAFF_ROLES } from "@repo/db/schema";
import { describe, expect, it } from "vitest";
import { GROUPS } from "../src/budget-ai/prompts";
import { STAFF_ROLE_WORDS } from "../src/inputs/accounts";
import {
  APP_LANGUAGES,
  BUDGET_INPUTS,
  BUDGET_MODEL,
  BUDGET_PDF_KINDS,
  BUDGET_QUALITIES,
  ISSUE_KINDS,
  ISSUE_PARTIES,
  ISSUE_STATUSES,
  MAX_CHAIN_LEVEL,
  OBRA_STAGES,
  LINE_SOURCES,
  OPTION_KINDS,
  PLANNING_REGIONS,
  PURCHASE_INVOICE_KINDS,
  PURCHASE_KINDS,
  PURCHASE_PAYMENT_METHODS,
  PURCHASE_REQUEST_STATUSES,
  PURCHASE_VAT_KINDS,
  statusesOf,
  type BudgetGenerationStatus,
  type CompanyStatus,
  type HitoEventAction,
  type PlanningStatus,
  type ProgressEvent,
  type PurchaseDocumentCheck,
} from "../src/contract";

type Words<K extends keyof typeof COLUMN_VALUES> = (typeof COLUMN_VALUES)[K][number];
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

// Core's unions without a list of their own: the same words, or this file doesn't compile.
const typed = {
  progressEventKind: true satisfies Same<ProgressEvent["kind"], Words<"progressEventKind">>,
  hitoEventAction: true satisfies Same<HitoEventAction, Words<"hitoEventAction">>,
  budgetGenerationStatus: true satisfies Same<BudgetGenerationStatus, Words<"budgetGenerationStatus">>,
  purchaseCheckStatus: true satisfies Same<PurchaseDocumentCheck["status"], Words<"purchaseCheckStatus">>,
  planningStatus: true satisfies Same<PlanningStatus, Words<"planningStatus">>,
  caeStatus: true satisfies Same<CompanyStatus, Words<"caeStatus">>,
};

// Every other list, against core's constant. A new list in COLUMN_VALUES needs a line here (or above).
const listed: Record<Exclude<keyof typeof COLUMN_VALUES, keyof typeof typed>, readonly string[] | "core has none"> = {
  language: APP_LANGUAGES,
  budgetInput: BUDGET_INPUTS,
  budgetPdf: BUDGET_PDF_KINDS,
  budgetModel: [BUDGET_MODEL],
  budgetQuality: BUDGET_QUALITIES,
  // Only budget.ts's own "chapter" | "option": the database's list is the only one.
  budgetChapterKind: "core has none",
  budgetOptionKind: OPTION_KINDS,
  budgetLineSource: LINE_SOURCES,
  issueKind: ISSUE_KINDS,
  issueParty: ISSUE_PARTIES,
  issueStatus: ISSUE_STATUSES,
  purchaseKind: PURCHASE_KINDS,
  purchaseMaterialStatus: statusesOf("material"),
  purchaseSubcontractStatus: statusesOf("subcontract"),
  purchaseVatKind: PURCHASE_VAT_KINDS,
  purchaseInvoiceKind: PURCHASE_INVOICE_KINDS,
  purchaseRequestStatus: PURCHASE_REQUEST_STATUSES,
  purchasePaymentMethod: PURCHASE_PAYMENT_METHODS,
  planningRegion: PLANNING_REGIONS,
};

const sorted = (words: readonly string[]) => [...words].sort();

describe("the database's words for each text column", () => {
  it.each(Object.entries(listed).filter(([, words]) => words !== "core has none"))("%s are core's", (key, words) => {
    expect(sorted(COLUMN_VALUES[key as keyof typeof listed])).toEqual(sorted(words as readonly string[]));
  });

  it("cover every list, the typed ones included", () => {
    expect(sorted([...Object.keys(listed), ...Object.keys(typed)])).toEqual(sorted(Object.keys(COLUMN_VALUES)));
  });

  // The three ranges the database repeats: the stages, the AI run's steps (0, one per group of chapters, the
  // save) and the levels of subcontracting. One raised in core needs a prod SQL file that replaces its CHECK.
  // The staff roles a body may name are written out in the inputs (which must not import the schema).
  it("the staff roles of the inputs are the schema's", () => {
    expect(sorted(STAFF_ROLE_WORDS)).toEqual(sorted(STAFF_ROLES));
  });

  it("the ranges are core's", () => {
    expect(COLUMN_RANGES).toEqual({
      obraStage: [OBRA_STAGES[0], OBRA_STAGES.at(-1)],
      generationStep: [0, GROUPS.length + 1],
      chainLevel: [1, MAX_CHAIN_LEVEL],
    });
  });
});
