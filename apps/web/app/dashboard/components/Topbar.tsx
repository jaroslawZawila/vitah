"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";

export default function Topbar() {
  const pathname = usePathname();
  const t = useTranslations("topbar");

  const titleKey = pathname.startsWith("/dashboard/users")
    ? "users"
    : pathname.startsWith("/dashboard/clients")
      ? "clients"
      : pathname === "/dashboard/projects/new"
        ? "newProject"
        : pathname.startsWith("/dashboard/projects/")
      ? "projectDetail"
      : "projects";

  return (
    <header className="flex min-h-12 items-center border-b px-4 sm:px-7">
      <div className="eyebrow">{t(`titles.${titleKey}`)}</div>
    </header>
  );
}
