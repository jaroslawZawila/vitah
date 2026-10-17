import { auth } from "../../auth";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { isAppLanguage } from "@repo/core/contract";
import { DEFAULT_LOCALE } from "../../i18n/locale";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import { getSubcontractorCounts } from "../actions/subcontractors";
import { setLanguageAction } from "../actions/users";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  if (!session?.user) redirect("/");
  const locale = await getLocale();
  // Only badges: a failure here (e.g. its tables not yet migrated) must not take the portal down.
  const subcontractors = await getSubcontractorCounts().catch((error: unknown) => {
    console.error(error);
    return null;
  });

  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <Sidebar
        name={session.user.name ?? null}
        email={session.user.email ?? null}
        isAdmin={session.user.role === "admin"}
        subcontractors={subcontractors}
        language={isAppLanguage(locale) ? locale : DEFAULT_LOCALE}
        onLanguageChange={setLanguageAction}
      />
      <div className="flex min-w-0 flex-col">
        <Topbar />
        <div className="flex w-full max-w-[1300px] min-w-0 flex-col gap-5 px-4 pt-[18px] pb-16 sm:px-7 sm:pt-6">
          {children}
        </div>
      </div>
    </div>
  );
}
