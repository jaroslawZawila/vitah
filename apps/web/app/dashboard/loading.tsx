import { useTranslations } from "next-intl";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const bar = "rounded-md bg-foreground/[0.07]";

/**
 * While a dashboard page loads: the outline of one (a title, a row of
 * figures, a list) in the workspace, the rail already in place. Quiet on
 * purpose: it stays unseen for a moment, so a page that comes at once never
 * flashes it, then breathes slowly. Without motion (`prefers-reduced-motion`,
 * handled in globals.css) it is simply there, still.
 */
export default function DashboardLoading() {
  const t = useTranslations("errorPages");
  return (
    <div role="status" className="flex animate-in flex-col gap-5 duration-300 fill-mode-both fade-in delay-150">
      <span className="sr-only">{t("loading")}</span>
      <div aria-hidden className="flex animate-pulse flex-col gap-5">
        <div className="flex flex-col gap-3 pt-1">
          <div className={cn(bar, "h-3 w-28")} />
          <div className={cn(bar, "h-8 w-[min(70%,22rem)]")} />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((tile) => (
            <div key={tile} className={cn(cardVariants({ size: "kpi" }), "gap-2.5", tile > 0 && "max-sm:hidden")}>
              <div className={cn(bar, "h-2.5 w-20")} />
              <div className={cn(bar, "h-6 w-28")} />
            </div>
          ))}
        </div>
        <div className={cn(cardVariants(), "gap-4")}>
          <div className={cn(bar, "h-4 w-40")} />
          {["w-full", "w-11/12", "w-4/5", "w-full", "w-2/3"].map((width, row) => (
            <div key={row} className={cn(bar, "h-3", width)} />
          ))}
        </div>
      </div>
    </div>
  );
}
