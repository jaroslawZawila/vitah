import { cn } from "@/lib/utils";

/**
 * Presentational: a "from – to" span of dates in figures. In a narrow column it breaks after the dash,
 * never inside a date, so a table keeps to its card instead of scrolling.
 */
export function DateRange({ text, className }: { text: string; className?: string }) {
  const at = text.indexOf(" – ");
  if (at < 0) return <span className={cn("num", className)}>{text}</span>;
  return (
    <span className={cn("whitespace-normal", className)}>
      <span className="num">{text.slice(0, at)} –</span> <span className="num">{text.slice(at + 3)}</span>
    </span>
  );
}
