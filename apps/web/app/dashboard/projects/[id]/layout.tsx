import Link from "next/link";
import { getTranslations } from "next-intl/server";

/** Shared by the project's tabs (General, Documents, Photos) in the sidebar. */
export default async function ProjectLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("projectDetailPage");

  return (
    <>
      <Link
        href="/dashboard/projects"
        className="inline-flex w-fit items-center gap-1.5 text-[13px] text-muted-foreground transition-colors hover:text-primary pointer-coarse:min-h-11"
      >
        ← {t("backToProjects")}
      </Link>
      {children}
    </>
  );
}
