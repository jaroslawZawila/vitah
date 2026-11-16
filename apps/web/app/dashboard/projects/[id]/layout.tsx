import { getTranslations } from "next-intl/server";
import ClientMessages from "@/i18n/ClientMessages";
import { cn } from "@/lib/utils";
import { backLinkClass } from "../../components/back-link-class";
import ProjectsBackLink from "../components/ProjectsBackLink";

/** Shared by the project's tabs (General, Obra, Budget, Payments, Documents) in the sidebar. */
export default async function ProjectLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("projectDetailPage");

  return (
    <ClientMessages scope="dashboard/projects/[id]">
      {/* Below `lg` it is the arrow before the project's tabs in the top bar (Sidebar). */}
      <ProjectsBackLink
        label={t("backToProjects")}
        className={cn(backLinkClass, "max-lg:hidden")}
      />
      {children}
    </ClientMessages>
  );
}
