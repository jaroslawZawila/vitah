import type { Paging } from "@repo/core/contract";

// What the paged lists' pages and API routes share: reading a list's query from
// a URL. A page takes what it understands and ignores the rest (a mistyped
// `?page=` is page 1, not an error); an API route passes the values on as they
// come, and core answers 400 to a page or limit that isn't one.

export type SearchParams = Record<string, string | string[] | undefined>;

/** A search parameter's (first) value, trimmed; "" when absent. */
export const param = (params: SearchParams, name: string) => {
  const value = params[name];
  return ((Array.isArray(value) ? value[0] : value) ?? "").trim();
};

/** `?page=`: a whole number from 1; anything else is the first page. */
export function pageParam(params: SearchParams): number {
  const raw = param(params, "page");
  return /^[1-9]\d{0,6}$/.test(raw) ? Number(raw) : 1;
}

/** One of `allowed`, else the first of them. */
export const choiceParam = <T extends string>(params: SearchParams, name: string, allowed: readonly T[]): T =>
  allowed.find((value) => value === param(params, name)) ?? allowed[0]!;

/** A YYYY-MM-DD day that exists, else "". */
export function dayParam(params: SearchParams, name: string): string {
  const raw = param(params, name);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "";
  const date = new Date(`${raw}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === raw ? raw : "";
}

/**
 * The last page there is, when the URL asks for one past it (a row deleted on
 * the last page, a bookmark of a longer list): `pathname` with the same query
 * on that page. Null when the page asked for exists.
 */
export function lastPageUrl(pathname: string, params: SearchParams, paging: Paging): string | null {
  if (paging.page <= paging.pages) return null;
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    const first = Array.isArray(value) ? value[0] : value;
    if (first !== undefined && name !== "page") query.set(name, first);
  }
  if (paging.pages > 1) query.set("page", String(paging.pages));
  const text = query.toString();
  return text ? `${pathname}?${text}` : pathname;
}

/** An API route's query string as an object: each parameter's first value. */
export function queryOf(request: Request): Record<string, string> {
  return Object.fromEntries(new URL(request.url).searchParams);
}

/** Whether the request asks for a page (`?page=` or `?limit=`): only then is a list paged. */
export const asksForPage = (query: Record<string, string>) => "page" in query || "limit" in query;
