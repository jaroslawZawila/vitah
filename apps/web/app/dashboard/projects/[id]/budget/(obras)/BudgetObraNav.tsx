"use client";

// Container beside every page of a budget: the other obras, to open the same
// page of theirs (the tab and the chapter kept), as a list from 1280px and as
// a bar over the budget below it; Alt+↑/↓ (at any width, the arrows' tooltip
// says so) for the obra before or after.

import { use, useEffect } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { BudgetOverview } from "@repo/core/contract";
import { BudgetObraBar, BudgetObraList } from "../../../components/budgets/BudgetObraList";
import { neighbours, switchBudgetHref } from "../../../components/budgets/budgets";

/** Whether a key press is typing (Alt+arrows move the caret there). */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));

export default function BudgetObraNav({
  overview,
  currentId,
  variant,
}: {
  /** Every obra's budget; null when signed out. */
  overview: Promise<BudgetOverview | null>;
  currentId: string;
  variant: "list" | "bar";
}) {
  const items = use(overview)?.items ?? [];
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const router = useRouter();
  const hrefOf = (projectId: string) => switchBudgetHref(pathname, search, projectId);
  // Not one of the tenant's obras: the page itself sends the user away.
  const around = items.some((i) => i.projectId === currentId) ? neighbours(items, currentId) : null;
  // The keys once only: the list is always mounted (hidden below xl).
  const keyed = variant === "list" && items.length > 1 ? around : null;
  const previousId = keyed?.previous.projectId;
  const nextId = keyed?.next.projectId;

  useEffect(() => {
    if (!previousId || !nextId) return;
    const to = { ArrowUp: previousId, ArrowDown: nextId };
    function onKey(event: KeyboardEvent) {
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown") || typing(event.target)) return;
      event.preventDefault();
      router.push(switchBudgetHref(pathname, search, to[event.key]));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [previousId, nextId, pathname, search, router]);

  if (!around) return null;
  const shared = { items, currentId, around, hrefOf };
  return variant === "list" ? (
    <BudgetObraList {...shared} />
  ) : (
    <div className="xl:hidden">
      <BudgetObraBar {...shared} onSelect={(id) => router.push(hrefOf(id))} />
    </div>
  );
}
