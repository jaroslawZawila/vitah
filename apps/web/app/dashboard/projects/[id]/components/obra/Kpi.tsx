import Link from "next/link";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { muted } from "./classes";
import ProgressBar from "./ProgressBar";

/** Presentational: a key figure card with an optional bar and hint lines. */
export default function Kpi({
  label,
  value,
  pct,
  barTone,
  hints = [],
  href,
  highlight = false,
  className,
}: {
  label: string;
  value: React.ReactNode;
  pct?: number;
  barTone?: "progress" | "brand";
  hints?: React.ReactNode[];
  href?: string;
  /** The page's headline figure, on dark ink. */
  highlight?: boolean;
  className?: string;
}) {
  const body = (
    <>
      <span className={cn("eyebrow", highlight && "text-rail-muted")}>{label}</span>
      <span
        className={cn(
          "font-heading text-2xl leading-[1.05] font-semibold tabular-nums [overflow-wrap:anywhere] sm:text-[30px]",
          "[&_small]:font-sans [&_small]:text-[13px] [&_small]:font-normal [&_small]:text-muted-foreground",
          highlight && "text-rail-accent [&_small]:text-rail-muted",
        )}
      >
        {value}
      </span>
      {pct !== undefined && (
        <ProgressBar pct={pct} tone={barTone} className={cn("my-1 flex-none", highlight && "border-white/15 bg-white/10")} />
      )}
      {hints.map((hint, index) => (
        <span
          key={index}
          className={cn(muted, highlight && "text-rail-muted")}
        >
          {hint}
        </span>
      ))}
    </>
  );
  const tile = cn(
    cardVariants({ size: "kpi" }),
    highlight && "border-rail bg-rail text-white",
    className,
  );
  return href ? (
    <Link href={href} className={cn(tile, "transition-colors hover:border-primary")}>
      {body}
    </Link>
  ) : (
    <div className={tile}>{body}</div>
  );
}
