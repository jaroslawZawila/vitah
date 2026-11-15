"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";

// A page's view (its filters, what is folded open) kept in its URL, replaced
// and never pushed, as the project list keeps its filters: a link, a reload
// or the browser's back shows the same view. The browser filters; nothing is
// fetched again.

/**
 * The view in the URL and how to change it. `toParams` gives each parameter
 * the view owns its value (null removes it); the URL's other parameters stay.
 * A navigation to other parameters (back, a link) wins over the state; the
 * URL this writes itself always matches it.
 */
export function useUrlState<T>(
  parse: (params: URLSearchParams) => T,
  toParams: (state: T) => Record<string, string | null>,
) {
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [state, setState] = useState(() => parse(new URLSearchParams(search)));
  const [seen, setSeen] = useState(search);
  const key = (value: T) => JSON.stringify(toParams(value));
  if (search !== seen) {
    setSeen(search);
    const next = parse(new URLSearchParams(search));
    if (key(next) !== key(state)) setState(next);
  }

  const update = (next: T) => {
    setState(next);
    const params = new URLSearchParams(window.location.search);
    const own = Object.entries(toParams(next));
    // The view's own parameters go after the others, always in `toParams`'s order.
    for (const [name] of own) params.delete(name);
    for (const [name, value] of own) if (value !== null) params.set(name, value);
    const query = params.toString();
    try {
      window.history.replaceState(null, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    } catch {
      // Safari limits replaceState calls (a held-down key while typing); the view still changes.
    }
  };
  return [state, update] as const;
}

/**
 * The groups folded open, as `?abierto=03,07` carries them: null when the URL
 * doesn't say (the page's default applies), [] when it says none.
 */
export function parseOpen(value: string | null): string[] | null {
  if (value === null) return null;
  return value.split(",").filter(Boolean);
}

/** `abierto`'s value: null (no parameter) for the default, else the codes ("" for none). */
export const openParam = (open: string[] | null) => (open === null ? null : open.join(","));

/**
 * The groups open: those the URL names, else `fallback` (the default: those
 * a filter matched, or none).
 */
export const openSet = (open: string[] | null, fallback: string[]): ReadonlySet<string> => new Set(open ?? fallback);

/**
 * `abierto` after a change: `next` (the groups to leave open) in the page's
 * order, or null when that is the default anyway, so a plain view keeps a
 * plain URL.
 */
export function nextOpen(next: ReadonlySet<string>, order: string[], fallback: string[]): string[] | null {
  const codes = order.filter((code) => next.has(code));
  const same = codes.length === fallback.length && fallback.every((code) => next.has(code));
  return same ? null : codes;
}

/** `abierto` with one group folded the other way. */
export function toggleOpen(open: string[] | null, code: string, order: string[], fallback: string[]): string[] | null {
  const next = new Set(openSet(open, fallback));
  if (!next.delete(code)) next.add(code);
  return nextOpen(next, order, fallback);
}

/**
 * A page's groups folded open as its view keeps them (`open`, null for the
 * default `fallback`) among those shown (`codes`), with the changes it writes
 * back through `setOpen` (Costes, Compras by line).
 */
export function openGroups(
  open: string[] | null,
  codes: string[],
  fallback: string[],
  setOpen: (open: string[] | null) => void,
) {
  const shown = openSet(open, fallback);
  return {
    isOpen: (code: string) => shown.has(code),
    allOpen: codes.every((code) => shown.has(code)),
    noneOpen: !codes.some((code) => shown.has(code)),
    toggle: (code: string) => setOpen(toggleOpen(open, code, codes, fallback)),
    expandAll: () => setOpen(nextOpen(new Set(codes), codes, fallback)),
    collapseAll: () => setOpen(nextOpen(new Set(), codes, fallback)),
  };
}
