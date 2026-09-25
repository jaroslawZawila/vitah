"use client";

import { useTranslations } from "next-intl";
import Link from "next/link";
import type { ClientOption, ProjectDocument } from "@repo/core/contract";
import type { ProjectDetail } from "../../../actions/projects";
import ProjectHeader from "./components/ProjectHeader";
import ClientAccessCard from "./components/ClientAccessCard";
import DocumentsCard from "./components/DocumentsCard";
import styles from "./page.module.css";

export default function ProjectDetailClient({
  project,
  canManageClient,
  assignableClients,
  documents,
  canManageDocuments,
}: {
  project: ProjectDetail;
  canManageClient: boolean;
  assignableClients: ClientOption[];
  documents: ProjectDocument[];
  canManageDocuments: boolean;
}) {
  const t = useTranslations("projectDetailPage");

  return (
    <>
      <Link href="/dashboard/projects" className={styles.backLink}>
        ← {t("backToProjects")}
      </Link>

      <ProjectHeader project={project} />

      <div className={styles.cards}>
        {canManageClient && (
          <ClientAccessCard
            projectId={project.id}
            client={project.client}
            assignableClients={assignableClients}
          />
        )}
        <DocumentsCard
          projectId={project.id}
          documents={documents}
          canManage={canManageDocuments}
        />
      </div>
    </>
  );
}
