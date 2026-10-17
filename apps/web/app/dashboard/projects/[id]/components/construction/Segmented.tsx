import { cn } from "@/lib/utils";

/** Presentational: a row of mutually exclusive buttons (a filter, a grouping). */
export default function Segmented<K extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: K;
  options: { key: K; label: string; count?: number }[];
  onChange: (key: K) => void;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn("inline-flex max-w-full gap-0.5 overflow-x-auto rounded-[10px] border bg-raise p-[3px]", className)}
    >
      {options.map((option) => (
        <button
          key={option.key}
          type="button"
          aria-pressed={value === option.key}
          onClick={() => onChange(option.key)}
          className="inline-flex min-h-[34px] flex-none cursor-pointer items-center gap-1.5 rounded-[7px] px-3 text-[13px] whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground pointer-coarse:min-h-11 aria-pressed:bg-card aria-pressed:font-semibold aria-pressed:text-foreground aria-pressed:shadow-card"
        >
          {option.label}
          {option.count !== undefined && <span className="num text-muted-foreground">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}
