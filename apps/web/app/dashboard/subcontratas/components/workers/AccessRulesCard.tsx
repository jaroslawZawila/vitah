"use client";

import { useTranslations } from "next-intl";
import { ACCESS_RULES } from "@repo/core/contract";
import { Card } from "@/components/ui/card";

/** Presentational: "Qué comprueba el acceso a obra" — the six rules. */
export default function AccessRulesCard() {
  const t = useTranslations("subcontractors");
  return (
    <Card aria-labelledby="access-rules-title">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="access-rules-title">{t("workers.rulesTitle")}</h2>
        <span className="text-[12.5px] text-muted-foreground">{t("workers.rulesHint")}</span>
      </div>
      <ol className="m-0 grid list-none gap-x-6 gap-y-3 p-0 md:grid-cols-2 xl:grid-cols-3">
        {ACCESS_RULES.map((rule, index) => (
          <li key={rule} className="flex gap-3 text-[13.5px]">
            <span className="grid size-6 flex-none place-items-center rounded-full bg-brand-soft font-mono text-xs font-semibold text-brand-ink">
              {index + 1}
            </span>
            <span>
              <b className="block text-sm font-semibold">{t(`accessRules.${rule}.title`)}</b>
              <span className="text-[12.5px] text-muted-foreground">{t(`accessRules.${rule}.detail`)}</span>
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
