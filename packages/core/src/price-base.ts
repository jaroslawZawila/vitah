import type { PriceBaseItem } from "./contract";
import { PRICE_BASE_2026 } from "./price-base-data";

// ─── Price base ───────────────────────────────────────────────────────────────
// The FRAMER 2026 unit prices, for the AI and the line picker. Prices already
// include overheads and profit, so every amount built from them is PEC.
// ─────────────────────────────────────────────────────────────────────────────

const ITEMS: PriceBaseItem[] = PRICE_BASE_2026.map(([code, description, unit, unitPriceCents]) => ({
  code,
  description,
  unit,
  unitPriceCents,
}));

const BY_CODE = new Map(ITEMS.map((item) => [item.code, item]));

/** Lower case without accents, so "cimentacion" finds "Cimentación". */
const fold = (text: string) =>
  text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

const SEARCH = ITEMS.map((item) => ({ item, text: fold(`${item.code} ${item.description}`) }));

export function priceBaseItem(code: string): PriceBaseItem | null {
  return BY_CODE.get(code) ?? null;
}

/** The items of some chapters ("03"), in code order. */
export function priceBaseForChapters(chapters: string[]): PriceBaseItem[] {
  const wanted = new Set(chapters);
  return ITEMS.filter((item) => wanted.has(item.code.slice(0, 2)));
}

/**
 * Items whose code or description contains every word of `query`, optionally
 * within one chapter; at most `limit`.
 */
export function searchPriceBase(query: string, { chapter, limit = 20 }: { chapter?: string; limit?: number } = {}) {
  const words = fold(query).split(/\s+/).filter(Boolean);
  return SEARCH.filter(
    ({ item, text }) => (!chapter || item.code.startsWith(`${chapter}.`)) && words.every((w) => text.includes(w)),
  )
    .slice(0, limit)
    .map(({ item }) => item);
}
