"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ProjectDetail } from "../../../actions/projects";
import ProjectHeader from "./components/ProjectHeader";
import ClientAccessCard from "./components/ClientAccessCard";
import styles from "./page.module.css";

export default function ProjectDetailClient({
  project,
  canManageClient,
}: {
  project: ProjectDetail;
  canManageClient: boolean;
}) {
  const t = useTranslations("projectDetailPage");

  return (
    <>
      <Link href="/dashboard/projects" className={styles.backLink}>
        ← {t("backToProjects")}
      </Link>

      <ProjectHeader project={project} />

      {canManageClient && (
        <ClientAccessCard projectId={project.id} client={project.client} />
      )}
    </>
  );
}
