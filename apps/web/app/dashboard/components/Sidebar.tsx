"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import styles from "./Sidebar.module.css";

const NAV_ITEMS = [
  { key: "projects", href: "/dashboard/projects", icon: "◫", adminOnly: false },
  { key: "users", href: "/dashboard/users", icon: "◐", adminOnly: true },
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
          <Link
            key={item.key}
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
