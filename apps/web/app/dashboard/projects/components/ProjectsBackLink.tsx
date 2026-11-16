"use client";

// "← Volver a proyectos" above a project's pages: back to the project list with
// the filters it last had in this tab (a budget or obra opened from a filtered
// list returns to it). Opened from a URL or a new tab, the plain list. On a phone
// it is an arrow at the start of the top bar's project tabs (`iconOnly`). It gives
// way to a page's own BackLink (an order, a hito, a chapter…): one way back.

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

let lastListQuery = "";

/** Called by the project list whenever its filters change (`filtersQuery`). */
export const rememberListQuery = (query: string) => {
  lastListQuery = query;
};

export default function ProjectsBackLink({
  label,
  iconOnly = false,
  className,
}: {
  label: string;
  /** An arrow, the label for screen readers and as a tooltip. */
  iconOnly?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={`/dashboard/projects${lastListQuery}`}
      className={cn(className, "[:root:has([data-back-link])_&]:hidden")}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly ? label : undefined}
    >
      {iconOnly ? <ArrowLeft aria-hidden className="size-[18px]" strokeWidth={1.8} /> : <>← {label}</>}
    </Link>
  );
}
