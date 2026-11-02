import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { backLinkClass } from "../../../../components/back-link-class";

/** Every page of a budget but its PDF viewer: back to every obra's budget (Proyectos › Presupuestos). */
export default async function BudgetLayout({ children }: { children: React.ReactNode }) {
  const t = await getTranslations("budgetsOverview");
  return (
    <>
      {/* Where the obras are listed, whichever page led here. Its data-back-link hides the project layout's "Volver a proyectos". */}
      <Link href="/dashboard/projects/presupuestos" data-back-link className={backLinkClass}>
        ← {t("allBudgets")}
      </Link>
      {children}
    </>
  );
}
