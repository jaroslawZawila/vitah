import { cn } from "@/lib/utils";

/** Presentational: a thin progress bar (decorative; show the % as text beside it). */
export default function ProgressBar({
  pct,
  className,
  tone = "progress",
}: {
  pct: number;
  className?: string;
  /** progress: blue, green once full; brand: verde oliva (a share, not a task). */
  tone?: "progress" | "brand";
}) {
  return (
    <span
      className={cn("relative block h-2 min-w-[70px] flex-1 overflow-hidden rounded-[5px] border bg-raise", className)}
      aria-hidden
    >
      <span
        className={cn("absolute inset-y-0 left-0", tone === "brand" ? "bg-primary" : pct >= 100 ? "bg-good" : "bg-info")}
        style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
      />
    </span>
  );
}
