// Part of @repo/core/contract (../contract.ts re-exports it): shared with the
// mobile app and browser code, so it never imports server-only code or zod.

import type { BudgetApproval, LinkedChange } from "./budget-approvals";
import type { BudgetRevisionStatus, ProgressStatus } from "./obra";

// ─── Budget in the FRAMER model (features/budget/TECH_DESIGN.md) ─────────────
// Twenty fixed chapters (01–20, 20 = Imprevistos, computed) and, below them,
// options priced apart (OP1, OP2… with lines OP.01, OP.02…).

export const BUDGET_MODEL = "framer20";
export const BUDGET_CHAPTER_CODES = Array.from({ length: 20 }, (_, i) => String(i + 1).padStart(2, "0"));
/** Chapter 20: a share of chapters 01–19, held as one computed line. */
export const CONTINGENCY_CHAPTER = "20";
export const CONTINGENCY_LINE = "20.01";
/**
 * Lines are priced at cost; the PEC adds gastos asociados and beneficio
 * industrial on top, each a share of the price (`unitPrice` in obra-calc.ts):
 * 75 % cost, 16 % gastos, 9 % beneficio. A new budget starts from these.
 */
export const DEFAULT_MARGINS = { overheadBp: 1600, profitBp: 900 };

export const OPTION_KINDS = ["extra", "alternative", "deduction"] as const;
export type OptionKind = (typeof OPTION_KINDS)[number];

/** Where a line came from; `computed` is chapter 20's line, never edited by hand. */
export const LINE_SOURCES = ["base", "estimated", "manual", "computed"] as const;
export type LineSource = (typeof LINE_SOURCES)[number];

export const BUDGET_PDF_KINDS = ["general", "detailed"] as const;
export type BudgetPdfKind = (typeof BUDGET_PDF_KINDS)[number];

export const BUDGET_QUALITIES = ["framer", "project"] as const;
export type BudgetQuality = (typeof BUDGET_QUALITIES)[number];

/** A budget line (partida) as entered: `quantity` has up to 3 decimals. */
export type NewBudgetLine = {
  code: string;
  description: string;
  unit: string;
  quantity: number;
  unitPriceCents: number;
};

export type BudgetLine = NewBudgetLine & {
  id: string;
  amountCents: number;
  executedPct: number;
  source: LineSource;
  baseCode: string | null;
  note: string | null;
  /** The same line in every revision (its code may change). */
  lineageId: string;
};

/** A price base entry (Base de precios FRAMER 2026). */
export type PriceBaseItem = { code: string; description: string; unit: string; unitPriceCents: number };

/** What the PDFs print besides numbers. */
export type BudgetTexts = {
  cover: {
    promoter: string;
    site: string;
    cadastral: string;
    surfaces: string;
    program: string;
    basis: string;
    scope: string;
    system: string;
  };
  justification: { intro: string; blocks: { title: string; text: string }[] };
  measurementCriterion: string;
  /** "Observaciones técnicas y puntos a cerrar": the AI's inconsistencies and assumptions. */
  annex: { id: string; kind: (typeof ANNEX_KINDS)[number]; title: string; text: string }[];
  exclusions: string[];
  /** "Este presupuesto sí incluye…". */
  includes: string;
};

/** The cover fields that name the project's own data: its client (`promoter`) and its address (`site`). */
export const IDENTITY_FIELDS = ["promoter", "site"] as const;
export type IdentityField = (typeof IDENTITY_FIELDS)[number];

/** A FRAMER revision's promoter and site against the project's client and address (core budget-identity.ts). */
export type BudgetIdentity = {
  /** The project's client (first name and surnames) and its address; null where it has none. */
  client: string | null;
  address: string | null;
  /** Cover fields that don't name the project's value (where it has one). */
  differs: IdentityField[];
  /** Cover fields filled where the project has nothing: the project could take them, by hand. */
  projectLacks: IdentityField[];
};

export type BudgetConditions = {
  validityDays: number;
  term: string;
  signingPlace: string;
};

/** An item of the "Antes de emitir" checklist (core budget-review.ts). */
/** "D. Fulano, en calidad de autopromotor…" → "D. Fulano" (the contract adds the capacity itself). */
export const promoterName = (promoter: string) => promoter.split(/,\s*en calidad de/i)[0]!.trim();

/** "OP.01–OP.04": the codes an option's (or chapter's) lines span. */
export const codeRange = (lines: { code: string }[]) =>
  lines.length === 0 ? "—" : lines.length === 1 ? lines[0]!.code : `${lines[0]!.code}–${lines[lines.length - 1]!.code}`;

/** Annex items of a budget's texts (`BudgetTexts.annex[].kind`). */
export const ANNEX_KINDS = ["inconsistency", "assumption", "note"] as const;

/** How each kind of review item is ticked off (`BudgetCheck.key`). */
export const checkKey = {
  annex: (id: string) => `annex:${id}`,
  line: (lineageId: string) => `line:${lineageId}`,
  ratio: (code: string) => `ratio:${code}`,
};

export type BudgetCheck = {
  key: string;
  kind: "inconsistency" | "assumption" | "estimated" | "ratio";
  title: string;
  detail: string;
  /** The chapter or line code it points at. */
  ref: string | null;
  /** The chapter to open for it, if any. */
  chapterCode: string | null;
  done: boolean;
  /** `ratio` checks: the chapter's €/m² built against the tenant's average (cents). */
  perM2Cents?: number;
  averageCents?: number;
};

/** How a chapter changed against the previous revision (★ up, ✦ new). */
export type ChapterChange = "up" | "down" | "new" | null;

export type BudgetChapter = {
  id: string;
  code: string;
  name: string;
  changeNote: string | null;
  /** Printed under the chapter's title in the PDFs ("Sustituye a…"). */
  pdfNote: string | null;
  /** Its lines' sum: at cost on the budget (`priceCents` adds the margins); at price in the obra. */
  totalCents: number;
  executedCents: number;
  progressPct: number;
  status: ProgressStatus;
  /** Share of the revision's total (at price), in basis points. */
  shareBp: number;
  /** The same chapter's total in the previous revision; null when it is new. */
  previousTotalCents: number | null;
  change: ChapterChange;
  /** The hito that closes this chapter, if any. */
  hitoCode: string | null;
  lines: BudgetLine[];
  /** Chapter 20 of the FRAMER model: its one line follows the others. */
  computed: boolean;
  /** Lines staff wrote (the computed one isn't). */
  lineCount: number;
  /** What it costs the client: its lines' cost plus its share of the margins. */
  priceCents: number;
  /** €/m² built at that price, in cents; null without a built area. */
  perM2Cents: number | null;
};

/** An option: priced apart from the PEC, chosen (or not) by the client on acceptance. */
export type BudgetOption = Omit<BudgetChapter, "shareBp"> & {
  optionKind: OptionKind;
  /** Alternatives: the line they replace. */
  replacesLine: string | null;
  /** Set once the revision is accepted. */
  chosen: boolean | null;
};

export type BudgetRevisionSummary = {
  id: string;
  number: number;
  status: BudgetRevisionStatus;
  /** The PEC: chapters only (01–20), never options, plus the margins. */
  totalCents: number;
  /** ISO timestamp. */
  acceptedAt: string | null;
  issuedOn: string | null;
};

export type BudgetRevision = BudgetRevisionSummary & {
  /** The chapters' lines, the computed one aside. */
  lineCount: number;
  /** The PEC per m² built, in cents. */
  perM2Cents: number | null;
  /** Chapters 01–20 at cost (ejecución material): the PEC before the margins. */
  costCents: number;
  /** Gastos asociados and beneficio industrial, each in bp of the PEC, and their amounts. */
  overheadBp: number;
  overheadCents: number;
  profitBp: number;
  profitCents: number;
  /** The unit prices' rounding to the cent: PEC − cost − gastos − beneficio (a few euros, either sign). */
  roundingCents: number;
  /** Options that add to the PEC and that subtract from it (at their price). */
  optionTotals: Record<"adding" | "subtracting", { count: number; cents: number }>;
  reference: string | null;
  vatRateBp: number;
  vatCents: number;
  builtAreaM2: number | null;
  usefulAreaM2: number | null;
  exclusions: string[];
  /** The revision before this one, to compare with. */
  previous: { number: number; totalCents: number } | null;
  /** Chapters of the previous revision that this one dropped. */
  removedChapters: { code: string; name: string; totalCents: number }[];
  chapters: BudgetChapter[];
  /** "framer20", or null for a budget entered before the FRAMER model (free chapters). */
  model: string | null;
  options: BudgetOption[];
  /** PEC + the price of the options the client chose (accepted revisions); the PEC otherwise. */
  contractTotalCents: number;
  contingencyBp: number;
  quality: BudgetQuality | null;
  texts: BudgetTexts;
  /** Its promoter and site against the project's client and address; null for budgets entered before the FRAMER model. */
  identity: BudgetIdentity | null;
  conditions: BudgetConditions;
  changeReason: string | null;
  validUntil: string | null;
  /** The day the client accepted it, and who they are (as staff typed it). */
  acceptedOn: string | null;
  acceptedBy: string | null;
  /** The staff user who registered the acceptance (at `acceptedAt`); null when unknown (registered before it was kept). */
  acceptedByUser: { id: string; name: string } | null;
  /** The client's signed copy among the project's documents, if one was filed. */
  signedDocumentId: string | null;
  /** The client's approval in the app registered as proof of the acceptance (beside the signed copy). */
  acceptedApprovalId: string | null;
  rejectedOn: string | null;
  /** The changes (CAM-) it prices: from Rev.1 on. */
  changes: LinkedChange[];
  /** Its requests to the client to approve it in the app, newest first. */
  approvals: BudgetApproval[];
  /** The PDFs stored when it was issued (document ids). */
  pdfs: Record<BudgetPdfKind, string | null>;
  checks: BudgetCheck[];
  /** The tenant's average €/m² built per chapter code (cents), from its other budgets. */
  ratios: Record<string, number>;
  /** Lines added, removed or changed against the previous revision. */
  lineChanges: BudgetLineChange[];
};

/** A line that changed against the previous revision (the computed 20.01 aside). */
export type BudgetLineChange = {
  code: string;
  description: string;
  kind: "added" | "removed" | "changed";
  before: { quantity: number; unitPriceCents: number; amountCents: number } | null;
  after: { quantity: number; unitPriceCents: number; amountCents: number } | null;
};

export type BudgetGenerationStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
/** A run still working: at most one per project. */
export const ACTIVE_GENERATION_STATUSES: BudgetGenerationStatus[] = ["queued", "running"];

/** A progress line of an AI run; the portal words it from `code` and `params`. */
export type BudgetGenerationLogEntry = {
  at: string;
  step: number;
  kind: "info" | "done" | "error";
  code: string;
  params?: Record<string, string | number>;
};

/** What the AI read from the project, for the progress screen. */
export type BudgetFacts = {
  promoter: string;
  site: string;
  architect: string;
  typology: string;
  builtAreaM2: number;
  usefulAreaM2: number;
  windows: number;
  bathrooms: number;
  bedrooms: number;
  inconsistencies: string[];
};

export type BudgetGeneration = {
  id: string;
  status: BudgetGenerationStatus;
  /** 0–5. */
  step: number;
  log: BudgetGenerationLogEntry[];
  error: string | null;
  revisionId: string | null;
  facts: BudgetFacts | null;
  createdAt: string;
};

/** GET /api/v1/projects/:id/budget: all revisions and one of them in full. */
export type ProjectBudget = {
  revisions: BudgetRevisionSummary[];
  revision: BudgetRevision | null;
  /** The newest AI run, if any. */
  generation: BudgetGeneration | null;
};
