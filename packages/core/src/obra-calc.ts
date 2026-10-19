import type {
  BudgetChapter,
  BudgetLine,
  BudgetOption,
  BudgetRevision,
  Hito,
  HitoStatus,
  MobilePhase,
  ObraStage,
  ObraTerm,
  ProgressStatus,
} from "./contract";
import { EXECUTION_STAGE, lineAmountCents } from "./contract";

// ─── Obra arithmetic ─────────────────────────────────────────────────────────
// Pure functions behind the budget, hitos and obra services: progress, dates,
// the contract's penalty and the app's phases. No database.
// ─────────────────────────────────────────────────────────────────────────────

/** Contract cl. 4ª: 150 €/calendar day from the 15th day late, up to 5 % of the price. */
const PENALTY_PER_DAY_CENTS = 150_00;
const PENALTY_FREE_DAYS = 14;
const PENALTY_CAP_BP = 500;

/** Contract cl. 2ª: payment is due 5 business days after the acta. */
const PAYMENT_TERM_BUSINESS_DAYS = 5;

/** When a hito's payment falls due: 5 business days after its acta (or invoice). */
export const paymentDueOn = (from: string) => addBusinessDays(from, PAYMENT_TERM_BUSINESS_DAYS);

const DAY_MS = 24 * 60 * 60 * 1000;
const toTime = (date: string) => Date.parse(`${date}T00:00:00Z`);
const toDate = (time: number) => new Date(time).toISOString().slice(0, 10);

/** Today's calendar date in Spain, YYYY-MM-DD. */
export function todayInSpain(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return now.toLocaleDateString("en-CA", { timeZone: "Europe/Madrid" });
}

/** `date` plus `days` calendar days. */
export const addDays = (date: string, days: number) => toDate(toTime(date) + days * DAY_MS);

/** `date` plus `days` Monday–Friday days (bank holidays are not known). */
export function addBusinessDays(date: string, days: number): string {
  let time = toTime(date);
  for (let left = days; left > 0; ) {
    time += DAY_MS;
    const weekday = new Date(time).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left--;
  }
  return toDate(time);
}

/** `part` of `whole` in basis points, rounded. */
export const shareBp = (part: number, whole: number) =>
  whole > 0 ? Math.round((part * 10_000) / whole) : 0;

/** `bp` basis points of `cents`, rounded to the cent. */
export const ofBp = (cents: number, bp: number) => Math.round((cents * bp) / 10_000);

/** Cents per m² of an area stored in cm² (hundredths of m²); null without an area. */
export const perM2Cents = (cents: number, areaCm2: number | null) =>
  areaCm2 ? Math.round((cents * 100) / areaCm2) : null;

// ─── Margins ─────────────────────────────────────────────────────────────────
// Budget lines are priced at cost; the client pays the cost plus gastos
// asociados and beneficio industrial. Both go into each unit price, to the
// cent, so every priced line is its quantity × its unit price and chapters and
// the PEC are plain sums (`linesPriceSql` in obra-data.ts is the same in SQL).
// Only the portal's budget shows the margins apart; the PDFs, obra, hitos and
// the app see the priced lines.

/** Gastos asociados (overhead) and beneficio industrial (profit), in bp of the cost. */
export type Margins = { overheadBp: number; profitBp: number };

/** A unit cost with both margins in, to the cent. */
export const unitPrice = (unitCostCents: number, { overheadBp, profitBp }: Margins) =>
  ofBp(unitCostCents, 10_000 + overheadBp + profitBp);

/** Lines at the client's price: each unit price with the margins in, its amount recomputed. */
export function priceLines<L extends { quantity: number; unitPriceCents: number; amountCents: number }>(lines: L[], margins: Margins): L[] {
  return lines.map((line) => {
    const unitPriceCents = unitPrice(line.unitPriceCents, margins);
    return { ...line, unitPriceCents, amountCents: lineAmountCents(line.quantity, unitPriceCents) };
  });
}

/** Chapters (or options) with their price: the sum of their priced lines. */
export function withPrices<C extends { lines: BudgetLine[] }>(chapters: C[], margins: Margins): (C & { priceCents: number })[] {
  return chapters.map((c) => ({ ...c, priceCents: priceLines(c.lines, margins).reduce((sum, l) => sum + l.amountCents, 0) }));
}

/** What the margins came to on `costCents` priced at `priceCents`, split between them by their %. */
export function marginsOn(costCents: number, priceCents: number, { overheadBp, profitBp }: Margins) {
  const marginCents = priceCents - costCents;
  const overheadCents = overheadBp + profitBp === 0 ? 0 : Math.round((marginCents * overheadBp) / (overheadBp + profitBp));
  return { overheadCents, profitCents: marginCents - overheadCents };
}

/** A revision at the client's prices: each chapter and option at its price, its lines priced. */
export function forClient(revision: BudgetRevision): BudgetRevision {
  const price = <C extends BudgetChapter | BudgetOption>(c: C): C => ({ ...c, totalCents: c.priceCents, lines: priceLines(c.lines, revision) });
  return { ...revision, chapters: revision.chapters.map(price), options: revision.options.map(price) };
}

export type Progress = {
  totalCents: number;
  executedCents: number;
  progressPct: number;
  status: ProgressStatus;
};

/**
 * Progress of lines weighted by their amounts. The % is rounded, but only
 * reads 100 once every line is done (and 0 only with nothing done).
 */
export function progressOf(lines: { amountCents: number; executedPct: number }[]): Progress {
  // A negative line (a chosen deduction: works the owner does) isn't built:
  // the progress is that of the works, and the deduction is applied to the
  // money executed in step with them.
  const works = lines.filter((line) => line.amountCents >= 0);
  let worksCents = 0;
  let worksExecutedCents = 0;
  for (const line of works) {
    worksCents += line.amountCents;
    worksExecutedCents += Math.round((line.amountCents * line.executedPct) / 100);
  }
  const deductedCents = lines.reduce((sum, line) => sum + Math.min(0, line.amountCents), 0);
  const share = worksCents > 0 ? worksExecutedCents / worksCents : works.length > 0 ? 0 : 1;
  const done = lines.length > 0 && works.every((line) => line.executedPct === 100);
  const started = works.some((line) => line.executedPct > 0);
  const rounded = Math.round(share * 100);
  const progressPct = done ? 100 : started ? Math.min(99, Math.max(1, rounded)) : 0;
  const status: ProgressStatus = done ? "done" : started ? "active" : "pending";
  return {
    totalCents: worksCents + deductedCents,
    executedCents: worksExecutedCents + Math.round(deductedCents * share),
    progressPct,
    status,
  };
}

/** The delay penalty for finishing `lateDays` calendar days after the contract's date. */
export function delayPenaltyCents(lateDays: number, totalCents: number): number {
  const penaltyDays = Math.max(0, lateDays - PENALTY_FREE_DAYS);
  return Math.min(penaltyDays * PENALTY_PER_DAY_CENTS, ofBp(totalCents, PENALTY_CAP_BP));
}

/** Where the works stand against their dates, and the delay penalty so far. */
export function obraTerm(
  startDate: string,
  completionDate: string,
  today: string,
  totalCents: number,
): ObraTerm {
  const start = toTime(startDate);
  const end = toTime(completionDate);
  const now = toTime(today);
  const week = now < start ? 0 : Math.floor((now - start) / (7 * DAY_MS)) + 1;
  const totalWeeks = Math.max(1, Math.ceil((end - start) / (7 * DAY_MS)));
  const lateDays = Math.max(0, Math.round((now - end) / DAY_MS));
  return { startDate, completionDate, week, totalWeeks, lateDays, penaltyCents: delayPenaltyCents(lateDays, totalCents) };
}

/**
 * A hito's place in the payment pipeline (see `HitoStatus`). `readyPct` is its
 * chapters' progress, which reads 100 only once every line is done.
 */
export function hitoStatus(hito: {
  chapterCount: number;
  readyPct: number;
  checks: { done: boolean }[];
  actaSignedOn: string | null;
  invoicedOn: string | null;
  paidOn: string | null;
}): HitoStatus {
  if (hito.paidOn) return "paid";
  if (hito.invoicedOn) return "invoiced";
  if (hito.actaSignedOn) return "signed";
  const { chapterCount, readyPct, checks } = hito;
  const chaptersDone = chapterCount === 0 || readyPct === 100;
  const hasWork = chapterCount > 0 || checks.length > 0;
  if (hasWork && chaptersDone && checks.every((c) => c.done)) return "ready";
  if (readyPct > 0 || checks.some((c) => c.done)) return "active";
  return "pending";
}

/** Photo ids and upload times, grouped by the chapter they show. */
export type PhotosByChapter = Map<string, { id: string; createdAt: number }[]>;

const PHASE_PHOTOS = 3;

/**
 * The app's phases: the hitos before the first one with chapters (contract,
 * engineering, licence) make one pre-construction phase; each other hito is a
 * phase of its own.
 */
export function buildPhases(
  stage: ObraStage,
  hitos: Hito[],
  photos: PhotosByChapter,
  /** The approved Planning baseline's dates by chapter code, if any. */
  plan: ReadonlyMap<string, { end: string }> | null = null,
): MobilePhase[] {
  const firstWorks = hitos.findIndex((h) => h.chapters.length > 0);
  const leading = firstWorks === -1 ? hitos : hitos.slice(0, firstWorks);
  const phases: MobilePhase[] = [];

  if (leading.length > 0) {
    const paid = leading.filter((h) => h.paidOn);
    const done = stage >= EXECUTION_STAGE || paid.length === leading.length;
    const finished = leading.map((h) => h.paidOn ?? h.actaSignedOn).filter((d) => d !== null);
    phases.push({
      key: "pre",
      name: null,
      status: done ? "done" : "active",
      progressPct: done ? 100 : Math.round((paid.length * 100) / leading.length),
      finishedOn: done && finished.length > 0 ? finished.sort().at(-1)! : null,
      plannedEnd: null,
      hitoIds: leading.map((h) => h.id),
      chapters: [],
      checks: [],
      photoIds: [],
      photoCount: 0,
    });
  }

  for (const hito of hitos.slice(leading.length)) {
    const chapterPhotos = hito.chapters
      .flatMap((c) => photos.get(c.code) ?? [])
      .sort((a, b) => b.createdAt - a.createdAt);
    // A hito without chapters (only checks) is done once it is ready for its acta.
    const done =
      hito.chapters.length > 0 ? hito.readyPct === 100 : hito.status !== "pending" && hito.status !== "active";
    phases.push({
      key: hito.code,
      name: hito.name,
      status: done ? "done" : hito.readyPct > 0 || hito.status === "active" ? "active" : "pending",
      progressPct: hito.readyPct,
      finishedOn: done ? (hito.actaSignedOn ?? hito.paidOn) : null,
      // Its last chapter's planned end (a chapter the plan leaves out, like 20, has none).
      plannedEnd: hito.chapters.flatMap((c) => plan?.get(c.code)?.end ?? []).sort().at(-1) ?? null,
      hitoIds: [hito.id],
      chapters: hito.chapters,
      checks: hito.checks,
      photoIds: chapterPhotos.slice(0, PHASE_PHOTOS).map((p) => p.id),
      photoCount: chapterPhotos.length,
    });
  }
  return phases;
}
