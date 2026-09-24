"use client";

import { useSearchParams, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ProjectWithRelations } from "../../../actions/projects";
import ProjectHeader from "./components/ProjectHeader";
import OverviewTab from "./components/OverviewTab";
import ConstructionTab from "./components/ConstructionTab";
import TechnicalTab from "./components/TechnicalTab";
import LogisticsTab from "./components/LogisticsTab";
import FinanceTab from "./components/FinanceTab";
import DocumentsTab from "./components/DocumentsTab";
import styles from "./page.module.css";

const TABS = ["overview", "construction", "technical", "logistics", "finance", "documents"] as const;
type TabKey = (typeof TABS)[number];

export default function ProjectDetailClient({
  project,
  canManageClient,
}: {
  project: ProjectWithRelations;
  canManageClient: boolean;
}) {
  const t = useTranslations("projectDetailPage");
  const searchParams = useSearchParams();
  const router = useRouter();

  const rawTab = searchParams.get("tab");
  const activeTab: TabKey = TABS.includes(rawTab as TabKey)
    ? (rawTab as TabKey)
    : "overview";

  function setTab(tab: TabKey) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", tab);
    router.replace(`?${params.toString()}`, { scroll: false });
  }

  return (
    <>
      <Link href="/dashboard/projects" className={styles.backLink}>
        ← {t("backToProjects")}
      </Link>

      <ProjectHeader project={project} />

      {/* Tab bar */}
      <div className={styles.tabBar}>
        {TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            className={activeTab === tab ? styles.tabActive : styles.tab}
            onClick={() => setTab(tab)}
          >
            {t(`tabs.${tab}`)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className={styles.tabContent}>
        {activeTab === "overview" && <OverviewTab project={project} canManageClient={canManageClient} />}
        {activeTab === "construction" && <ConstructionTab project={project} />}
        {activeTab === "technical" && <TechnicalTab project={project} />}
        {activeTab === "logistics" && <LogisticsTab project={project} />}
        {activeTab === "finance" && <FinanceTab project={project} />}
        {activeTab === "documents" && <DocumentsTab project={project} />}
      </div>
    </>
  );
}
