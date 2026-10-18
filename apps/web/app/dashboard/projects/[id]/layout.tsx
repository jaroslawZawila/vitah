import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { cn } from "@/lib/utils";
import { backLinkClass } from "../../components/back-link-class";

/** Shared by the project's tabs (General, Obra, Budget, Payments, Documents) in the sidebar. */
export default async function ProjectLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("projectDetailPage");

  return (
    <>
      {/* Hidden on a page with its own BackLink (an order, a hito, a chapter…): one way back. */}
      <Link href="/dashboard/projects" className={cn(backLinkClass, "[:root:has([data-back-link])_&]:hidden")}>
        ← {t("backToProjects")}
      </Link>
      {children}
    </>
  );
}
