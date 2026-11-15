"use client";

import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { placeOf } from "./place";

/** Where the user is ("Compras — Facturas"), from the address; also the browser tab's title. */
export default function Topbar() {
  const pathname = usePathname();
  const t = useTranslations();
  const { title, part } = placeOf(pathname);
  const section = t(`topbar.titles.${title}`);
  const label = part ? t("topbar.withPart", { section, part: t(`sidebar.${part}`) }) : section;

  return (
    <header className="flex min-h-12 items-center border-b px-4 sm:px-7">
      <title>{t("topbar.documentTitle", { label })}</title>
      <div className="eyebrow">{label}</div>
    </header>
  );
}
