import Link from "next/link";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { getBudgetsOverview } from "../../../../../actions/budget";
import { backLinkClass } from "../../../../components/back-link-class";
import BudgetObraNav from "./BudgetObraNav";

/**
 * Every page of a budget but its PDF viewer, with the other obras beside it to
 * switch to (Proyectos › Presupuestos). The list isn't awaited: the budget
 * shows first and the obras fill in beside it.
 */
export default async function BudgetLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const [{ id }, t] = await Promise.all([params, getTranslations("budgetsOverview.switcher")]);
  const overview = getBudgetsOverview();
  return (
    <>
      {/* Where the obras are listed, whichever page led here. Its data-back-link hides the project layout's "Volver a proyectos". */}
      <Link href="/dashboard/projects/presupuestos" data-back-link className={backLinkClass}>
        ← {t("back")}
      </Link>
      <div className="flex items-start gap-[22px]">
        <aside className="hidden w-[292px] flex-none flex-col xl:sticky xl:top-4 xl:flex xl:max-h-[calc(100svh-2rem)]">
          <Suspense>
            <BudgetObraNav overview={overview} currentId={id} variant="list" />
          </Suspense>
        </aside>
        <div className="flex min-w-0 flex-1 flex-col gap-4">
          <Suspense>
            <BudgetObraNav overview={overview} currentId={id} variant="bar" />
          </Suspense>
          {children}
        </div>
      </div>
    </>
  );
}
