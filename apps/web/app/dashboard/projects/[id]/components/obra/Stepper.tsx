import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export type Step = {
  key: string;
  label: string;
  meta?: string;
  state: "done" | "current" | "todo";
  /** Set when staff may jump to this step. */
  onSelect?: () => void;
  selectLabel?: string;
};

const MARKER: Record<Step["state"], string> = {
  done: "bg-primary text-primary-foreground",
  current: "border-2 border-primary bg-card",
  todo: "border-2 border-border bg-card group-hover/marker:border-primary group-focus-visible/marker:border-primary",
};

/** Presentational: a horizontal (desktop) / vertical (phone) row of steps. */
export default function Stepper({ steps, label }: { steps: Step[]; label: string }) {
  return (
    <ol
      className="grid gap-3 md:grid-cols-[repeat(var(--steps),minmax(0,1fr))] md:gap-2"
      aria-label={label}
      style={{ "--steps": steps.length } as React.CSSProperties}
    >
      {steps.map((step) => {
        const marker = (
          <span
            className={cn(
              "inline-flex size-6 flex-none items-center justify-center rounded-full transition-colors",
              MARKER[step.state],
            )}
            aria-hidden
          >
            {step.state === "done" && <Check size={14} strokeWidth={2.6} />}
            {step.state === "current" && <span className="size-2 rounded-full bg-primary" />}
          </span>
        );
        return (
          <li
            key={step.key}
            className="grid grid-cols-[44px_minmax(0,1fr)] grid-rows-[auto_auto] items-center gap-x-2 md:flex md:flex-col md:items-stretch md:gap-2"
            aria-current={step.state === "current" ? "step" : undefined}
          >
            <span className="row-span-2 flex items-center justify-center md:justify-start md:gap-1">
              {step.onSelect ? (
                <button
                  type="button"
                  className="group/marker inline-flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full md:-m-2.5"
                  onClick={step.onSelect}
                  aria-label={step.selectLabel}
                >
                  {marker}
                </button>
              ) : (
                marker
              )}
              <span
                className={cn("hidden h-0.5 flex-1 rounded-full md:block", step.state === "done" ? "bg-primary" : "bg-border")}
              />
            </span>
            <span
              className={cn(
                "text-[12.5px] leading-tight font-semibold",
                step.state === "todo" && "text-muted-foreground",
              )}
            >
              {step.label}
            </span>
            {step.meta && <span className="text-[11.5px] leading-snug text-muted-foreground">{step.meta}</span>}
          </li>
        );
      })}
    </ol>
  );
}
