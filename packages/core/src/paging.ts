import { invalid } from "./errors";

// ─── Paging ──────────────────────────────────────────────────────────────────
// What the long lists share (Compras' orders, invoices and payments, the
// workers): a page is asked for by number (`page`, from 1) and size (`limit`),
// as the portal's URLs carry them (`?page=`). A list asked for without either
// (an older API client) comes whole as before, up to MAX_UNPAGED, and says so
// when that cut it (`paging.truncated`). What must hold every row (an export)
// reads the pages in turn (`allPages`). Pure, through @repo/core/contract.
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_PAGE_SIZE = 50;
export const MAX_PAGE_SIZE = 200;
/** The most a list asked for without paging returns. */
export const MAX_UNPAGED = 5000;
/** The most rows `allPages` gathers: far above any real tenant's list. Past it, it fails instead of cutting. */
export const MAX_ALL_ROWS = 200_000;

/** As they arrive: numbers, or the strings of a URL. */
export type PageQuery = { page?: unknown; limit?: unknown };

/**
 * Where a page sits in its list: `total` counts every row the filters keep.
 * `truncated` only on a list asked for without paging that MAX_UNPAGED cut:
 * `total` rows there are, `limit` of them came (ask by `?page=` for the rest).
 */
export type Paging = { page: number; limit: number; total: number; pages: number; truncated?: true };

const given = (value: unknown) => value !== undefined && value !== null && value !== "";

/** A whole number from 1 up; `invalid_page` otherwise. */
function positive(value: unknown): number {
  const n = typeof value === "number" ? value : typeof value === "string" && /^\d{1,9}$/.test(value.trim()) ? Number(value) : NaN;
  if (!Number.isInteger(n) || n < 1) throw invalid("invalid_page");
  return n;
}

/** `unpaged`: no page was asked for, so the window is the whole list up to MAX_UNPAGED. */
export type PageWindow = { page: number; limit: number; offset: number; unpaged?: true };

/**
 * The rows a query asks for: its page (1 by default) of `limit` rows (50 by
 * default, 200 at most: a larger one is cut, not refused). Neither given: the
 * whole list, up to MAX_UNPAGED. A page or limit that isn't a whole number
 * from 1 is `invalid_page` (400).
 */
export function pageWindow(query: PageQuery = {}): PageWindow {
  if (!given(query.page) && !given(query.limit)) return { page: 1, limit: MAX_UNPAGED, offset: 0, unpaged: true };
  const page = given(query.page) ? positive(query.page) : 1;
  const limit = given(query.limit) ? Math.min(positive(query.limit), MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  return { page, limit, offset: (page - 1) * limit };
}

/**
 * The window with the list's `total`; a page past the end is empty, with the
 * pages there are. A whole list the cap cut short says so (`truncated`).
 */
export const pagingOf = ({ page, limit, unpaged }: PageWindow, total: number): Paging => ({
  page,
  limit,
  total,
  pages: Math.max(1, Math.ceil(total / limit)),
  ...(unpaged && total > limit ? { truncated: true as const } : {}),
});

/**
 * Every row of a paged list, for what must hold them all (an export): `load`
 * answers one page (its rows, and the list's `paging`), asked for in turn,
 * MAX_PAGE_SIZE rows at a time, until the last. Rows arriving while it reads
 * shift the pages: with `key`, a row that comes twice is kept once. Never
 * cut: a list of more than `ceiling` rows throws, loudly (not a `CoreError`:
 * nothing a caller did), rather than answer a part as if it were the whole.
 */
export async function allPages<T>(
  load: (query: { page: number; limit: number }) => Promise<{ rows: T[]; paging: Paging }>,
  { key, ceiling = MAX_ALL_ROWS }: { key?: (row: T) => unknown; ceiling?: number } = {},
): Promise<T[]> {
  const rows: T[] = [];
  const seen = new Set<unknown>();
  for (let page = 1; ; page++) {
    const { rows: pageRows, paging } = await load({ page, limit: MAX_PAGE_SIZE });
    if (paging.total > ceiling) throw new Error(`The list has ${paging.total} rows: more than the ${ceiling} that are read whole`);
    for (const row of pageRows) {
      if (key && seen.has(key(row))) continue;
      if (key) seen.add(key(row));
      rows.push(row);
    }
    if (pageRows.length === 0 || page >= paging.pages) return rows;
  }
}

/** A filter's value as a URL carries it: its text, or null when absent or empty. */
export const filterText = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);

/** A search box's text as an `ilike` pattern (its %, _ and \ taken literally), or null when empty. */
export function searchPattern(value: unknown): string | null {
  const text = typeof value === "string" ? value.trim().slice(0, 100) : "";
  return text ? `%${text.replace(/[\\%_]/g, "\\$&")}%` : null;
}
