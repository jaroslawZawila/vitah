"use client";

// Proyectos › Compras before an obra is chosen: the picker, and every obra
// below it (filtered as it is typed into). Choosing one opens its Compras.

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SearchFilter } from "../[id]/components/purchasing/Filters";
import { purchasesHref } from "../[id]/components/purchasing/links";
import ObraLabel from "../components/ObraLabel";
import { matchesObra, type ObraOption } from "../components/obra-options";

export default function ObraPurchasesEntry({ options }: { options: ObraOption[] }) {
  const t = useTranslations("obraPurchases");
  const router = useRouter();
  const [query, setQuery] = useState("");
  const shown = options.filter((o) => matchesObra(o, query));

  return (
    <div className="flex flex-col gap-[18px]">
      <header className="min-w-0">
        <span className="eyebrow">{t("eyebrow")}</span>
        <h1 className="mt-1.5">{t("title")}</h1>
        <p className="mt-1 max-w-[640px] text-[14px] text-muted-foreground">{t("description")}</p>
      </header>
      <form
        role="search"
        className="w-full max-w-[640px]"
        onSubmit={(event) => {
          event.preventDefault();
          // Enter opens the obra when only one matches.
          if (shown.length === 1) router.push(purchasesHref(shown[0]!.id));
        }}
      >
        <SearchFilter label={t("search")} value={query} onChange={setQuery} className="w-full max-w-none shadow-card" />
      </form>
      <section className={cn(cardVariants({ size: "flush" }), "py-1.5")} aria-label={t("list")}>
        {shown.length === 0 ? (
          <p className="px-[18px] py-6 text-center text-[13.5px] text-muted-foreground">{options.length === 0 ? t("none") : t("noMatch")}</p>
        ) : (
          <ul className="m-0 list-none p-0">
            {shown.map((option) => (
              <li key={option.id} className="border-b last:border-b-0">
                <Link href={purchasesHref(option.id)} className="flex min-h-12 items-center px-[18px] py-2.5 transition-colors hover:bg-raise">
                  <ObraLabel obra={option} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
