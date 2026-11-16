"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { placeOf } from "./place";

/**
 * Where the user is ("Compras — Facturas"), from the address; also the browser tab's title. Shown
 * from `lg` up only: on a phone the top bar's current section and tab already say it.
 */
export default function Topbar() {
  const pathname = usePathname();
  const t = useTranslations("topbar");
  const sidebar = useTranslations("sidebar");
  const { title, part } = placeOf(pathname);
  const section = t(`titles.${title}`);
  const label = part ? t("withPart", { section, part: sidebar(part) }) : section;

  return (
    <header className="flex min-h-12 items-center border-b px-4 max-lg:hidden sm:px-7">
      <title>{t("documentTitle", { label })}</title>
      <div className="eyebrow">{label}</div>
    </header>
  );
}
