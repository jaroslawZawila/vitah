"use client";

import { useId, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslations } from "next-intl";
import { ChevronDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { filterBox } from "../[id]/components/construction/classes";
import ObraLabel from "./ObraLabel";
import { matchesObra, type ObraOption } from "./obra-options";

/**
 * Presentational: the bar at the top of a section that shows its obra and
 * picks another by code, client or address (a combobox: type, then arrows
 * and Enter, or a click; Escape closes the list, then clears). Choosing the
 * obra on screen just closes it. On a phone it is one line, the obra's code
 * and client, that opens the search.
 */
export default function ObraPicker({
  options,
  currentId,
  onSelect,
  className,
}: {
  options: ObraOption[];
  currentId: string;
  onSelect: (id: string) => void;
  className?: string;
}) {
  const t = useTranslations("obraPicker");
  const listId = useId();
  const searchId = useId();
  const input = useRef<HTMLInputElement>(null);
  // Phones only: whether the one-line bar shows its search.
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const current = options.find((o) => o.id === currentId);
  const matches = options.filter((o) => matchesObra(o, query));
  const highlighted = open ? matches[active] : undefined;

  function show() {
    setOpen(true);
    setActive(0);
  }
  function choose(option: ObraOption) {
    setQuery("");
    setOpen(false);
    setExpanded(false);
    if (option.id !== currentId) onSelect(option.id);
  }

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-card px-3.5 py-2.5 shadow-card max-sm:py-0 sm:flex-row sm:items-center sm:gap-4",
        className,
      )}
    >
      {/* On a phone, one line naming the obra that opens the search (whose list shows its address). */}
      <button
        type="button"
        aria-expanded={expanded}
        aria-controls={searchId}
        className="relative flex min-h-11 min-w-0 items-center gap-2.5 text-left sm:hidden"
        onClick={() => {
          if (expanded) return setExpanded(false);
          // Rendered before the focus, within the tap, so the phone opens its keyboard.
          flushSync(() => setExpanded(true));
          input.current?.focus();
        }}
      >
        <span className="eyebrow flex-none">{t("label")}</span>
        {current && (
          <span className="min-w-0 flex-1 truncate text-sm">
            <b className="num text-brand-ink">{current.ref}</b>
            {current.clientName ? ` · ${current.clientName}` : ""}
          </span>
        )}
        <ChevronDown
          aria-hidden
          className={cn("ml-auto size-4 flex-none text-muted-foreground transition-transform", expanded && "rotate-180")}
        />
        <span className="sr-only">{t("change")}</span>
      </button>
      <div className="flex min-w-0 flex-1 items-baseline gap-2.5 max-sm:hidden">
        <span className="eyebrow flex-none">{t("label")}</span>
        {current && <ObraLabel obra={current} />}
      </div>
      <div id={searchId} className={cn("relative w-full sm:w-[300px] sm:flex-none", expanded ? "max-sm:pb-2.5" : "max-sm:hidden")}>
        <label className={cn(filterBox, "w-full text-muted-foreground focus-within:border-primary")}>
          <Search aria-hidden className="size-4 flex-none" />
          <input
            ref={input}
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={highlighted ? `${listId}-${highlighted.id}` : undefined}
            aria-label={t("search")}
            value={query}
            placeholder={t("placeholder")}
            className="min-h-9 w-full min-w-0 bg-transparent text-foreground outline-none pointer-coarse:min-h-11"
            onFocus={show}
            onBlur={() => setOpen(false)}
            onChange={(e) => {
              setQuery(e.target.value);
              show();
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                e.preventDefault();
                if (!open) return show();
                const last = matches.length - 1;
                setActive((i) => (e.key === "ArrowDown" ? Math.min(i + 1, last) : Math.max(i - 1, 0)));
              } else if (e.key === "Enter") {
                e.preventDefault();
                if (highlighted) choose(highlighted);
              } else if (e.key === "Escape") {
                // First closes the list, then clears what was typed.
                e.preventDefault();
                e.stopPropagation();
                if (open) setOpen(false);
                else setQuery("");
              }
            }}
          />
        </label>
        {open && (
          <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-[340px] overflow-y-auto rounded-[10px] border bg-card p-1 shadow-card sm:left-auto sm:w-[420px]">
            <ul id={listId} role="listbox" aria-label={t("results")} className="m-0 list-none p-0">
              {matches.map((option, index) => (
                <li
                  key={option.id}
                  id={`${listId}-${option.id}`}
                  role="option"
                  aria-selected={index === active}
                  className="flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-[7px] px-3 py-1.5 aria-selected:bg-raise"
                  // Before the input's blur closes the list.
                  onMouseDown={(e) => {
                    e.preventDefault();
                    choose(option);
                  }}
                  onMouseEnter={() => setActive(index)}
                >
                  <ObraLabel obra={option} />
                  {option.id === currentId && <span className="flex-none text-meta text-muted-foreground">{t("current")}</span>}
                </li>
              ))}
            </ul>
            {matches.length === 0 && <p className="m-0 px-3 py-2.5 text-sm text-muted-foreground">{t("noMatch")}</p>}
          </div>
        )}
        <span role="status" className="sr-only">
          {open ? t("count", { count: matches.length }) : ""}
        </span>
      </div>
    </div>
  );
}
