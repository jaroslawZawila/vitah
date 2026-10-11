"use client";

import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

/**
 * Presentational: a panel anchored under its trigger (the price base picker,
 * a line's menu). Closes on Escape or a click outside.
 */
export default function Popover({
  open,
  onClose,
  className,
  label,
  children,
}: {
  open: boolean;
  onClose: () => void;
  className?: string;
  label: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    const onClick = (event: MouseEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(event.target as Node)) onClose();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={label}
      className={cn("absolute top-full right-0 z-20 mt-1.5 flex flex-col rounded-[14px] border bg-popover shadow-modal", className)}
    >
      {children}
    </div>
  );
}
