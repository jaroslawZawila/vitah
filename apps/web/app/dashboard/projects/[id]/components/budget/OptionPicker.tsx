"use client";

import { Check } from "lucide-react";
import { useTranslations } from "next-intl";
import { codeRange, type BudgetOption } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useObraFormat } from "../obra/format";
import { OPTION_VARIANT } from "./OptionSummary";

/** Presentational: a revision's options to tick (the client's choice), each with its kind and price. */
export default function OptionPicker({
  legend,
  options,
  chosen,
  onToggle,
}: {
  legend: string;
  options: BudgetOption[];
  chosen: Set<string>;
  onToggle: (optionId: string) => void;
}) {
  const t = useTranslations("budget.accept");
  const f = useObraFormat();
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="pb-2 text-sm font-semibold">{legend}</legend>
      {options.map((option) => {
        const on = chosen.has(option.id);
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(option.id)}
            className={cn("grid grid-cols-[22px_auto_minmax(0,1fr)_auto] items-center gap-2.5 rounded-[10px] border px-3 py-2.5 text-left text-sm", on && "border-primary bg-brand-soft")}
          >
            <span className={cn("flex size-[18px] items-center justify-center rounded-[5px] border-[1.5px]", on ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/50")}>
              {on && <Check size={12} aria-hidden />}
            </span>
            <Badge variant={OPTION_VARIANT[option.optionKind]}>{t(`kinds.${option.optionKind}`)}</Badge>
            <span>
              <span className="num text-muted-foreground">{codeRange(option.lines)}</span> · {option.name}
            </span>
            <span className="num font-semibold">{f.signedMoney(option.priceCents)}</span>
          </button>
        );
      })}
    </fieldset>
  );
}

/** The ticked options of a picker, and toggling one. */
export function toggled(current: Set<string>, optionId: string) {
  const next = new Set(current);
  if (next.has(optionId)) next.delete(optionId);
  else next.add(optionId);
  return next;
}
