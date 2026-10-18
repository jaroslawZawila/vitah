"use client";

// "← Volver" on a page opened from several places (an order from the project's Compras,
// the company-wide Compras or a supplier's ficha): it goes back to wherever the user came
// from. Its `data-back-link` hides the project layout's "Volver a proyectos". Opened straight from a URL or a new tab there is nowhere in the portal to go back
// to, so it is a plain link to `href`, the page's parent.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, type MouseEvent, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { backLinkClass } from "./back-link-class";

// The portal pages visited in this tab, oldest first. A visit to the page before the
// current one is taken as going back (the browser's or ours) and pops; any other is a push.
// Only the last few matter, so it keeps at most MAX_VISITED. A link to the page two back
// (A → B → A) also pops, so this can hold fewer pages than the real history, never more:
// at worst the link goes to `href` instead of back, never out of the portal.
const MAX_VISITED = 50;
let visited: string[] = [];

/** Records the portal's client-side navigations; mounted once by the dashboard layout. */
export function NavigationTracker() {
  const pathname = usePathname();
  useEffect(() => {
    if (visited.at(-1) === pathname) return;
    if (visited.at(-2) === pathname) visited.pop();
    else visited = [...visited, pathname].slice(-MAX_VISITED);
  }, [pathname]);
  return null;
}

/** Whether there is a portal page to go back to. */
export const canGoBack = () => visited.length > 1;

/** For tests: forget the visits. */
export const resetVisited = () => {
  visited = [];
};

export default function BackLink({ href, className, children }: { href: string; className?: string; children?: ReactNode }) {
  const t = useTranslations("navigation");

  function onClick(event: MouseEvent<HTMLAnchorElement>) {
    // Ctrl/⌘-click and the like open `href` in a new tab as usual.
    if (!canGoBack() || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    // What router.back() does; the app router restores the page on popstate.
    window.history.back();
  }

  return (
    <Link
      href={href}
      onClick={onClick}
      data-back-link
      className={cn(backLinkClass, className)}
    >
      ← {children ?? t("back")}
    </Link>
  );
}
