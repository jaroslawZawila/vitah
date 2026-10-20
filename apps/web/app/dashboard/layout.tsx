import { auth } from "../../auth";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { isAppLanguage } from "@repo/core/contract";
import { DEFAULT_LOCALE } from "../../i18n/locale";
import { NavigationTracker } from "./components/BackLink";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";
import { getPurchasingCounts } from "../actions/purchase-invoices";
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
  const badges = <T,>(load: Promise<T>) =>
    load.catch((error: unknown) => {
      console.error(error);
      return null;
    });
  const [subcontractors, purchases] = await Promise.all([badges(getSubcontractorCounts()), badges(getPurchasingCounts())]);

  return (
    <div className="min-h-svh lg:grid lg:grid-cols-[236px_minmax(0,1fr)]">
      <NavigationTracker />
      <Sidebar
        name={session.user.name ?? null}
        email={session.user.email ?? null}
        isAdmin={session.user.role === "admin"}
        subcontractors={subcontractors}
        purchases={purchases}
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
