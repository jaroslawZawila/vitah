"use client";

import Link from "next/link";
import { useParams, usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { key: "projects", href: "/dashboard/projects", icon: "◫", adminOnly: false },
  { key: "clients", href: "/dashboard/clients", icon: "◉", adminOnly: true },
  { key: "users", href: "/dashboard/users", icon: "◐", adminOnly: true },
] as const;

/** Routes under `dashboard/projects/[id]/`, shown nested under "Projects". */
const PROJECT_TABS = [
  { key: "general", path: "" },
  { key: "documents", path: "/documents" },
  { key: "photos", path: "/photos" },
] as const;

export default function Sidebar({
  name,
  email,
  isAdmin,
}: {
  name: string | null;
  email: string | null;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const t = useTranslations("sidebar");
  const displayName = name || email || "";
  // Only set on `projects/[id]` routes, so not on e.g. `projects/new`.
  const { id: projectId } = useParams<{ id?: string }>();

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>
        <div className={styles.logoMark}>V</div>
        <div>
          <div className={styles.logoBrand}>ViTAH</div>
          <div className={styles.logoSub}>OS Platform</div>
        </div>
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.filter((item) => isAdmin || !item.adminOnly).map((item) => (
          <div key={item.key}>
            <Link
              href={item.href}
              className={
                pathname.startsWith(item.href)
                  ? styles.navItemActive
                  : styles.navItem
              }
            >
              <span className={styles.navIcon}>{item.icon}</span>
              {t(item.key)}
            </Link>
            {item.key === "projects" && projectId && pathname.startsWith(item.href) && (
              <ProjectTabs projectId={projectId} pathname={pathname} />
            )}
          </div>
        ))}
      </nav>

      <div className={styles.userArea}>
        <div className={styles.avatar}>
          {displayName.charAt(0).toUpperCase()}
        </div>
        <div>
          <div className={styles.userName}>{displayName}</div>
          {name && email && <div className={styles.userLocation}>{email}</div>}
        </div>
      </div>
    </aside>
  );
}

function ProjectTabs({ projectId, pathname }: { projectId: string; pathname: string }) {
  const t = useTranslations("sidebar.projectTabs");

  return (
    <ul className={styles.subNav} aria-label={t("label")}>
      {PROJECT_TABS.map((tab) => {
        const href = `/dashboard/projects/${projectId}${tab.path}`;
        const active = pathname === href;
        return (
          <li key={tab.key}>
            <Link
              href={href}
              className={active ? styles.subNavItemActive : styles.subNavItem}
              aria-current={active ? "page" : undefined}
            >
              {t(tab.key)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
