"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-reads the page every `everyMs` while `active` (e.g. an AI review under way), for `forMs` at most. */
export function useRefreshWhile(active: boolean, { everyMs = 5_000, forMs = 180_000 } = {}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = setInterval(() => {
      if (Date.now() - started > forMs) clearInterval(timer);
      else router.refresh();
    }, everyMs);
    return () => clearInterval(timer);
  }, [active, everyMs, forMs, router]);
}
