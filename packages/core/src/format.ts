// How ViTAH writes figures and dates for people: the portal (through
// `useFormat()` in apps/web/lib/format.ts), the budget PDFs and core's texts.
//
// One style everywhere:
// - numbers always group thousands, in the language's own way: "8.543,98" in
//   Spanish (whose default would leave "8543,98"), "8,543.98" in English;
// - money always has two decimals: "8.543,98 €", "€8,543.98";
// - a date is day, short month and year: "10 mar 2026" / "10 Mar 2026"; a
//   moment adds the time in Spain: "10 mar 2026, 14:05".
//
// Built by hand, not with Intl's grouping or month names, so that the text is
// the same whatever ICU the server and each browser carry (the server render
// and the browser's must match). Intl is used only to place a moment in
// Spain's time zone. DB-free and React-free: safe for the browser.

/** The time zone every moment is shown in. */
export const DISPLAY_TIME_ZONE = "Europe/Madrid";

type Lang = "es" | "en";
const lang = (locale: string): Lang => (locale.startsWith("en") ? "en" : "es");

const MARKS: Record<Lang, { group: string; decimal: string }> = {
  es: { group: ".", decimal: "," },
  en: { group: ",", decimal: "." },
};

/** A true minus sign, as the portal and the PDFs print it. */
const MINUS = "−";
const NBSP = " ";

const MONTHS: Record<Lang, readonly string[]> = {
  es: ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

const groupDigits = (digits: string, separator: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, separator);

export type NumberOptions = {
  /** Decimals always shown (default 0). */
  minDecimals?: number;
  /** Decimals at most, rounded half away from zero (default: `minDecimals`). */
  maxDecimals?: number;
};

/**
 * |value| with `decimals` decimals, a half rounded away from zero as written in decimal: 1.005 → "1.01".
 * `toFixed` alone rounds the double's binary value, which sits just under such a half (1.005 → "1.00").
 */
function fixed(value: number, decimals: number): string {
  const abs = Math.abs(value);
  const shifted = `${abs}`.includes("e") ? "e" : `${Math.round(Number(`${abs}e${decimals}`))}`;
  // Beyond what a double writes without an exponent there is no half left to round.
  return shifted.includes("e") ? abs.toFixed(decimals) : Number(`${shifted}e-${decimals}`).toFixed(decimals);
}

/** |value| as grouped digits with its decimals, no sign. */
function unsigned(value: number, l: Lang, { minDecimals = 0, maxDecimals = minDecimals }: NumberOptions) {
  const [whole = "0", fraction = ""] = fixed(value, maxDecimals).split(".");
  let decimals = fraction;
  while (decimals.length > minDecimals && decimals.endsWith("0")) decimals = decimals.slice(0, -1);
  const marks = MARKS[l];
  return `${groupDigits(whole, marks.group)}${decimals ? `${marks.decimal}${decimals}` : ""}`;
}

/** "−" before a figure that is below zero once rounded (never "−0"). */
const minus = (text: string) => (/[1-9]/.test(text) ? MINUS : "");

/** A number, grouped: 8543.98 → "8.543,98" (with `maxDecimals: 2`); 12500 → "12.500". */
export function formatNumber(value: number, locale: string, options: NumberOptions = {}): string {
  const text = unsigned(value, lang(locale), options);
  return `${value < 0 ? minus(text) : ""}${text}`;
}

/** A number with exactly `decimals` decimals: 253.4 → "253,40" (forms' amounts). */
export function formatDecimal(value: number, locale: string, decimals = 2): string {
  return formatNumber(value, locale, { minDecimals: decimals });
}

/** A quantity with up to 3 decimals: 12345.5 → "12.345,5". */
export function formatQuantity(value: number, locale: string): string {
  return formatNumber(value, locale, { maxDecimals: 3 });
}

/** Euro cents with two decimals and no symbol (tables headed "€"): 854398 → "8.543,98", −19000 → "−190,00". */
export function formatAmount(cents: number, locale: string): string {
  return formatDecimal(cents / 100, locale);
}

/** Euro cents as money: 854398 → "8.543,98 €" / "€8,543.98"; −19000 → "−190,00 €" / "−€190.00". */
export function formatMoney(cents: number, locale: string): string {
  const l = lang(locale);
  const text = unsigned(cents / 100, l, { minDecimals: 2 });
  const sign = cents < 0 ? minus(text) : "";
  return l === "en" ? `${sign}€${text}` : `${sign}${text}${NBSP}€`;
}

/** "+" before a figure above zero, "−" below, nothing for zero. */
const signOf = (value: number, text: string) => (value > 0 && /[1-9]/.test(text) ? "+" : value < 0 ? minus(text) : "");

/** Money with its sign always shown: "+2.570,00 €", "−1.200,00 €", "0,00 €". */
export function formatSignedMoney(cents: number, locale: string): string {
  const text = formatMoney(Math.abs(cents), locale);
  return `${signOf(cents, text)}${text}`;
}

/** An amount (no symbol) with its sign always shown: "+196,00", "−196,00". */
export function formatSignedAmount(cents: number, locale: string): string {
  const text = formatAmount(Math.abs(cents), locale);
  return `${signOf(cents, text)}${text}`;
}

/** Basis points as a percentage: 1926 → "19,26 %" / "19.26%" (up to 2 decimals unless told otherwise). */
export function formatPercent(bp: number, locale: string, options: NumberOptions = { maxDecimals: 2 }): string {
  const l = lang(locale);
  const text = formatNumber(bp / 100, l, options);
  return l === "en" ? `${text}%` : `${text}${NBSP}%`;
}

/** Basis points as a signed percentage, with `decimals` decimals: "+1,4 %", "−0,8 %". */
export function formatSignedPercent(bp: number, locale: string, decimals = 1): string {
  const text = formatPercent(Math.abs(bp), locale, { minDecimals: decimals });
  return `${signOf(bp, text)}${text}`;
}

const KB = 1024;
const MB = KB * KB;

/** A file's size: "340 kB", "3,1 MB". */
export function formatFileSize(bytes: number, locale: string): string {
  return bytes < MB
    ? `${formatNumber(Math.max(1, Math.round(bytes / KB)), locale)} kB`
    : `${formatNumber(bytes / MB, locale, { maxDecimals: 1 })} MB`;
}

// Dates.

type Day = { year: number; month: number; day: number };
type Moment = Day & { hour: number; minute: number };

let spainClock: Intl.DateTimeFormat | undefined;

/** A moment's day and time in Spain. */
function inSpain(date: Date): Moment {
  spainClock ??= new Intl.DateTimeFormat("en-GB", {
    timeZone: DISPLAY_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(spainClock.formatToParts(date).map((p) => [p.type, Number(p.value)]));
  return { year: parts.year!, month: parts.month!, day: parts.day!, hour: parts.hour! % 24, minute: parts.minute! };
}

const CALENDAR_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * What a date value means: a calendar day ("2026-03-10") is that day as it
 * is; a timestamp (an ISO string or a Date, also a date column's UTC midnight)
 * is the day it was in Spain.
 */
function toMoment(value: string | Date): Moment {
  if (typeof value === "string") {
    const match = CALENDAR_DAY.exec(value);
    if (match) return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), hour: 0, minute: 0 };
  }
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) throw new RangeError(`Not a date: ${String(value)}`);
  return inSpain(date);
}

const two = (n: number) => String(n).padStart(2, "0");
const dayText = ({ year, month, day }: Day, l: Lang) => `${day} ${MONTHS[l][month - 1]} ${year}`;

/** What a missing date shows: an em dash. */
export const NO_DATE = "—";

/** A day: "2026-03-10" (or a timestamp, in Spain's time) → "10 mar 2026" / "10 Mar 2026"; none → "—". */
export function formatDate(value: string | Date | null | undefined, locale: string): string {
  return value == null || value === "" ? NO_DATE : dayText(toMoment(value), lang(locale));
}

/** A moment in Spain's time: "10 mar 2026, 14:05". */
export function formatDateTime(value: string | Date, locale: string): string {
  const moment = toMoment(value);
  return `${dayText(moment, lang(locale))}, ${two(moment.hour)}:${two(moment.minute)}`;
}

/** Two days: "13 oct 2026 – 17 oct 2026", or one when they are the same. */
export function formatDateRange(from: string | Date, to: string | Date, locale: string): string {
  const [start, end] = [formatDate(from, locale), formatDate(to, locale)];
  return start === end ? start : `${start} – ${end}`;
}

/** A day's short month, "oct": only for a chart or timeline axis whose year is shown nearby. */
export function formatMonth(value: string | Date, locale: string): string {
  return MONTHS[lang(locale)][toMoment(value).month - 1]!;
}

// Search.

/** Lower case without accents, for matching what is typed: "Peñacastillo" is found as "penacastillo". */
export const foldAccents = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
