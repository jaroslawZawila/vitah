"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import styles from "./Topbar.module.css";

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
    <header className={styles.topbar}>
      <div className={styles.title}>{t(`titles.${titleKey}`)}</div>
    </header>
  );
}
