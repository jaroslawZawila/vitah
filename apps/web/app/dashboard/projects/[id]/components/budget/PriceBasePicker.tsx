"use client";

import { useEffect, useState, type ComponentProps } from "react";
import { useTranslations } from "next-intl";
import type { PriceBaseItem } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { chip } from "../obra/classes";
import { useObraFormat } from "../obra/format";
import Popover from "./Popover";

type Props = {
  chapter: string | null;
  onSearch: (query: string, chapter?: string) => Promise<PriceBaseItem[]>;
  onPick: (item: PriceBaseItem) => void;
  onFree: () => void;
  freeLabel: string;
};

/**
 * Presentational: a button that opens the price base picker under it, and
 * closes it once an entry (or a line outside the base) is picked.
 */
export default function PriceBaseButton({
  label,
  variant,
  size,
  popoverClassName,
  ...picker
}: Props & { label: string; popoverClassName?: string } & Pick<ComponentProps<typeof Button>, "variant" | "size">) {
  const [open, setOpen] = useState(false);
  const close = (then: () => void) => () => {
    setOpen(false);
    then();
  };
  return (
    <span className="relative">
      <Button type="button" variant={variant} size={size} onClick={() => setOpen(!open)} aria-expanded={open}>
        + {label}
      </Button>
      <Popover open={open} onClose={() => setOpen(false)} label={label} className={popoverClassName}>
        <PriceBasePicker
          {...picker}
          onPick={(item) => close(() => picker.onPick(item))()}
          onFree={close(picker.onFree)}
        />
      </Popover>
    </span>
  );
}

/**
 * Search the FRAMER price base (in one chapter or all of it) and pick an
 * entry; or add a line that isn't in the base. `onSearch` comes from the
 * container (a server action).
 */
function PriceBasePicker({ chapter, onSearch, onPick, onFree, freeLabel }: Props) {
  const t = useTranslations("budget.picker");
  const f = useObraFormat();
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"chapter" | "all">(chapter ? "chapter" : "all");
  const [results, setResults] = useState<PriceBaseItem[]>([]);

  useEffect(() => {
    let current = true;
    const timer = setTimeout(async () => {
      const found = await onSearch(query, scope === "chapter" && chapter ? chapter : undefined);
      if (current) setResults(found);
    }, 200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [query, scope, chapter, onSearch]);

  return (
    <div className="flex w-[min(560px,90vw)] flex-col">
      <div className="flex flex-col gap-2.5 p-3.5">
        <div className="flex items-baseline justify-between gap-2">
          <b className="text-sm">{t("title")}</b>
          <span className="text-xs text-muted-foreground">{t("hint")}</span>
        </div>
        <Input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} aria-label={t("search")} placeholder={t("search")} />
        {chapter && (
          <div className="flex gap-1.5" role="group" aria-label={t("scope")}>
            {(["chapter", "all"] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={scope === key}
                onClick={() => setScope(key)}
                className={chip}
              >
                {key === "chapter" ? t("inChapter", { code: chapter }) : t("all")}
              </button>
            ))}
          </div>
        )}
      </div>
      <ul className="max-h-[320px] overflow-y-auto">
        {results.length === 0 && <li className="border-t px-3.5 py-3 text-[13px] text-muted-foreground">{t("noResults")}</li>}
        {results.map((item) => (
          <li key={item.code} className="grid grid-cols-[52px_minmax(0,1fr)_auto] items-center gap-x-2.5 gap-y-0.5 border-t px-3.5 py-2.5 text-[13.5px] hover:bg-raise">
            <span className="num text-muted-foreground">{item.code}</span>
            <span>
              {item.description}
              <span className="block text-xs text-muted-foreground">
                {item.unit} · <span className="num">{f.money(item.unitPriceCents)}</span>
              </span>
            </span>
            <Button type="button" variant="outline" size="sm" onClick={() => onPick(item)} aria-label={t("addLabel", { code: item.code })}>
              {t("add")}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-2 border-t px-3.5 py-2.5">
        <Button type="button" variant="ghost" size="sm" onClick={onFree}>
          {freeLabel}
        </Button>
        <span className="text-xs text-muted-foreground">{t("freeHint")}</span>
      </div>
    </div>
  );
}
