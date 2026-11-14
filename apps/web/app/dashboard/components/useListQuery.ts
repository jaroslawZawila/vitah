"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

// A paged list's filters live in its URL (`?page=&q=…`): the server filters,
// counts and cuts the page. The container changes them here; the page then
// renders again with the new rows.

/**
 * The list's query and how to change it. `set` replaces the URL with `patch`
 * applied (an empty value removes its parameter) and goes back to the first
 * page; `pageHref` is the same URL on another page.
 */
export function useListQuery() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  const urlWith = (patch: Record<string, string | null | undefined>, page?: number) => {
    const next = new URLSearchParams(params.toString());
    for (const [name, value] of Object.entries(patch)) {
      if (value) next.set(name, value);
      else next.delete(name);
    }
    if (page && page > 1) next.set("page", String(page));
    else next.delete("page");
    const query = next.toString();
    return query ? `${pathname}?${query}` : pathname;
  };

  return {
    pending,
    set: (patch: Record<string, string | null | undefined>) =>
      startTransition(() => router.replace(urlWith(patch), { scroll: false })),
    pageHref: (page: number) => urlWith({}, page),
  };
}

/** How many searches may be waiting for the URL to show them: only the last ones can still arrive. */
const MAX_AWAITED = 8;

/**
 * A search box over a URL parameter: what is typed shows at once, and reaches
 * `onSearch` once typing stops. The box mirrors every change of `value` it did
 * not cause (back, forward, a link): the URL's text replaces what is shown, and
 * is never searched again. The URL catching up with what the box itself just
 * searched is the one change that leaves the box alone, so nothing typed
 * meanwhile is lost. A search counts as the box's own once: after the URL has
 * shown it, the same text coming back (forward to it, say) is the URL's.
 */
export function useSearchText(value: string, onSearch: (text: string) => void, delayMs = 300) {
  const [text, setText] = useState(value);
  const [seen, setSeen] = useState(value);
  // What was searched and the URL has not shown yet, oldest first.
  const [awaited, setAwaited] = useState<string[]>([]);
  if (value !== seen) {
    setSeen(value);
    const own = awaited.lastIndexOf(value);
    // Its own search arriving: that one and those before it are no longer awaited.
    if (own >= 0) setAwaited(awaited.slice(own + 1));
    else {
      // Not its doing: the box shows the URL's text, and nothing it had searched is awaited any more.
      setAwaited([]);
      setText(value);
    }
  }
  const search = useRef(onSearch);
  useEffect(() => {
    search.current = onSearch;
  });
  useEffect(() => {
    const next = text.trim();
    // Nothing to search: the box says what the URL does (as typed, or as just taken from it).
    if (next === value.trim()) return;
    const timer = setTimeout(() => {
      setAwaited((list) => [...list, next].slice(-MAX_AWAITED));
      search.current(next);
    }, delayMs);
    return () => clearTimeout(timer);
  }, [text, value, delayMs]);
  return [text, setText] as const;
}
