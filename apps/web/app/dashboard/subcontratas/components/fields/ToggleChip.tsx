"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Presentational: a pill that is on or off (`aria-pressed`). `brand` picks
 * values (oficios, EPIs, chapters); `solid` is a list filter.
 */
export default function ToggleChip({
  on,
  onToggle,
  tone = "brand",
  children,
}: {
  on: boolean;
  onToggle: () => void;
  tone?: "brand" | "solid";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={cn(
        "inline-flex min-h-9 items-center gap-1.5 rounded-full border bg-card px-3 text-[13px] font-semibold text-muted-foreground transition-colors pointer-coarse:min-h-11",
        tone === "brand" ? "hover:border-primary" : "hover:bg-raise",
        on && tone === "brand" && "border-primary bg-brand-soft text-brand-ink",
        on && tone === "solid" && "border-foreground bg-foreground text-background hover:bg-foreground",
      )}
    >
      {children}
    </button>
  );
}
