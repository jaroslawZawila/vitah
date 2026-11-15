import type { BudgetPdfKind, BudgetRevision } from "../contract";
import { formatAmount, formatDate, formatDecimal, formatPercent } from "../format";

// What the budget PDF is drawn from, and the Spanish number formats it prints.

export type Letterhead = { name: string; tagline: string; address: string; phone: string };

export type BudgetPdfData = {
  kind: BudgetPdfKind;
  /** Drafts carry a "BORRADOR" watermark: only an issued revision's PDF is what was sent. */
  draft: boolean;
  revision: BudgetRevision;
  letterhead: Letterhead;
  /** The site as the footer and cover print it. */
  site: string;
  /** "Octubre de 2026": the month it was (or will be) issued. */
  issuedLabel: string;
  year: number;
  builtAreaCm2: number | null;
  usefulAreaCm2: number | null;
  /** € per m² built / useful, in cents. */
  perBuilt: number | null;
  perUseful: number | null;
  /** Chapters 01–19: what chapter 20 is a share of. */
  contingencyBase: number;
  hitos: { code: string; name: string; scope: string; pctBp: number; billingMoment: string }[];
  /** Every revision up to this one, for the "Resumen de revisiones". */
  history: { number: number; date: string; reason: string | null; totalCents: number }[];
  /** The contract's {placeholders}. */
  contractValues: Record<string, string>;
};

/** Cents as Spanish money without the symbol: 415346 → "4.153,46" (the template always groups). */
export const money = (cents: number) => formatAmount(cents, "es");

/** A quantity with two decimals: 28.15 → "28,15", 1234.5 → "1.234,50". */
export const num = (value: number) => formatDecimal(value, "es");

/** A day as the PDFs print it: "2026-10-14" → "14 oct 2026". */
export const day = (value: string) => formatDate(value, "es");

/** Basis points as a percentage with `decimals` decimals: 1246 → "12,46 %". */
export const pct = (bp: number, decimals = 2) => formatPercent(bp, "es", { minDecimals: decimals });

/** Replaces `{name}` with `values.name` (unknown names stay, to be noticed). */
export function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** "2026-10-14" → "Octubre de 2026". */
export function monthLabel(date: string) {
  const [year, month] = date.split("-");
  const name = MONTHS[Number(month) - 1] ?? "";
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} de ${year}`;
}
