import { cn } from "@/lib/utils";
import type { ObraOption } from "./obra-options";

/** Presentational: an obra as the pickers show it, its code and client over its address. */
export default function ObraLabel({ obra, className }: { obra: ObraOption; className?: string }) {
  return (
    <span className={cn("flex min-w-0 flex-col gap-0.5 text-sm", className)}>
      <span>
        <b className="num text-brand-ink">{obra.ref}</b>
        {obra.clientName && <span> · {obra.clientName}</span>}
      </span>
      <span className="text-meta text-muted-foreground [overflow-wrap:anywhere]">{obra.address}</span>
    </span>
  );
}
