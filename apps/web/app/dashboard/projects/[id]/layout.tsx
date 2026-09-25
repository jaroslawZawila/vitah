import Link from "next/link";
import { getTranslations } from "next-intl/server";
import styles from "./page.module.css";

/** Shared by the project's tabs (General, Documents, Photos) in the sidebar. */
export default async function ProjectLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("projectDetailPage");

  return (
    <>
      <Link href="/dashboard/projects" className={styles.backLink}>
        ← {t("backToProjects")}
      </Link>
      {children}
    </>
  );
}
