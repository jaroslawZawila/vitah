"use client";

// "← Volver a proyectos" above a project's pages: back to the project list with
// the filters it last had in this tab (a budget or obra opened from a filtered
// list returns to it). Opened from a URL or a new tab, the plain list.

import Link from "next/link";

let lastListQuery = "";

/** Called by the project list whenever its filters change (`filtersQuery`). */
export const rememberListQuery = (query: string) => {
  lastListQuery = query;
};

export default function ProjectsBackLink({ label, className }: { label: string; className?: string }) {
  return (
    <Link href={`/dashboard/projects${lastListQuery}`} className={className}>
      ← {label}
    </Link>
  );
}
