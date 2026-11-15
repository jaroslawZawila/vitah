"use client";

import type { ReactNode } from "react";
import { ChevronRight } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";

/**
 * A chapter folded into one table row (Costes, Compras by line): the whole row
 * toggles it, its first cell is the button (chevron, code, then `label`), and
 * `children` are the row's other cells.
 */
export default function FoldRow({
  code,
  label,
  open,
  controls,
  onToggle,
  colSpan,
  children,
}: {
  code: string;
  /** The chapter's name and what needs a look, after its code. */
  label: ReactNode;
  open: boolean;
  /** The id of the rows it folds. */
  controls: string;
  onToggle: () => void;
  /** The columns the button spans. */
  colSpan?: number;
  children: ReactNode;
}) {
  return (
    <TableRow className="cursor-pointer bg-raise/60" onClick={onToggle}>
      <TableCell colSpan={colSpan} className="p-0 whitespace-normal">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={controls}
          onClick={(event) => {
            event.stopPropagation();
            onToggle();
          }}
          className="flex min-h-11 w-full cursor-pointer items-start gap-x-2.5 py-2 pl-[18px] text-left"
        >
          <ChevronRight aria-hidden className={cn("mt-0.5 size-4 flex-none text-muted-foreground transition-transform", open && "rotate-90")} />
          <span className="num flex-none font-semibold">{code}</span>
          <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2.5 gap-y-1">{label}</span>
        </button>
      </TableCell>
      {children}
    </TableRow>
  );
}
