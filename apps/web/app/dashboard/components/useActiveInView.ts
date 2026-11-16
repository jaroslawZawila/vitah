"use client";

import { useEffect, type RefObject } from "react";

/** What a strip marks as the item the user is on. */
const CURRENT = '[aria-current="page"], [aria-selected="true"], [data-active]';

/**
 * Scrolls a strip that scrolls sideways (tabs, the phone's top bar) so its current item is in view,
 * centred, on load and whenever `key` changes (the page). `current` picks that item (by default the link
 * or tab marked current, or `data-active`). Only the strip moves, never the page; a strip
 * that fits (desktop) is left alone.
 */
export function useActiveInView(ref: RefObject<HTMLElement | null>, key?: unknown, current = CURRENT) {
  useEffect(() => {
    const strip = ref.current;
    if (!strip || strip.scrollWidth <= strip.clientWidth) return;
    const item = strip.querySelector<HTMLElement>(current);
    if (!item) return;
    const box = strip.getBoundingClientRect();
    const at = item.getBoundingClientRect();
    if (at.left >= box.left && at.right <= box.right) return;
    strip.scrollLeft += at.left - box.left - (box.width - at.width) / 2;
  }, [ref, key, current]);
}
