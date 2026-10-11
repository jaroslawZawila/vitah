"use client";

import Link from "next/link";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { BudgetChapter, BudgetLine, BudgetRevision } from "@repo/core/contract";
import { cardVariants } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { chip, codeChip, muted } from "../obra/classes";
import { useObraFormat } from "../obra/format";
import LineTable, { type LineOps, type MenuItem } from "./LineTable";
import PriceBaseButton from "./PriceBasePicker";
import SaveOnBlur from "./SaveOnBlur";

/** The line operations, and what only a chapter's lines offer. */
export type LineHandlers = LineOps & {
  onRename: (chapter: BudgetChapter, name: string) => void;
  onNote: (chapter: BudgetChapter, note: string) => void;
  onDuplicate: (chapter: BudgetChapter, line: BudgetLine) => void;
  onDeduction: (line: BudgetLine) => void;
  onAlternative: (line: BudgetLine) => void;
  onMove: (chapter: BudgetChapter, line: BudgetLine) => void;
};

type Filter = "all" | "estimated" | "noted";

/**
 * Presentational: one chapter's lines beside the list of the twenty; the
 * options have their own tab. `handlers` are set on a draft the caller may edit.
 */
export default function LinesView({
  revision,
  code,
  hrefOf,
  optionsHref,
  handlers,
}: {
  revision: BudgetRevision;
  code: string;
  hrefOf: (code: string) => string;
  optionsHref: string;
  handlers?: LineHandlers;
}) {
  const t = useTranslations("budget.lines");
  const f = useObraFormat();
  const [filter, setFilter] = useState<Filter>("all");
  const chapter = revision.chapters.find((c) => c.code === code) ?? revision.chapters[0]!;
  const { computed, perM2Cents } = chapter;
  const editable = handlers && !computed;
  const average = revision.ratios[chapter.code];
  const offAverage = revision.checks.some((c) => c.kind === "ratio" && c.chapterCode === chapter.code);
  const shown = chapter.lines.filter((l) => (filter === "estimated" ? l.source === "estimated" : filter === "noted" ? Boolean(l.note) : true));
  const counts: Record<Filter, number> = {
    all: chapter.lines.length,
    estimated: chapter.lines.filter((l) => l.source === "estimated").length,
    noted: chapter.lines.filter((l) => l.note).length,
  };
  const menuFor = (line: BudgetLine): MenuItem[] =>
    handlers
      ? [
          { label: t("edit"), onSelect: () => handlers.onEdit(chapter, line) },
          { label: t("duplicate"), onSelect: () => handlers.onDuplicate(chapter, line) },
          { label: t("deduction"), onSelect: () => handlers.onDeduction(line) },
          { label: t("alternative"), onSelect: () => handlers.onAlternative(line) },
          { label: t("move"), onSelect: () => handlers.onMove(chapter, line) },
          { label: t("delete"), onSelect: () => handlers.onDelete(line), destructive: true },
        ]
      : [];

  return (
    <div className="flex flex-col gap-4.5 lg:flex-row lg:items-start">
      <nav aria-label={t("chapters")} className={cn(cardVariants(), "gap-0.5 p-2.5 lg:w-[300px] lg:flex-none")}>
        <span className="eyebrow px-2.5 pt-1.5 pb-2">{t("chapters")}</span>
        <div className="flex gap-1 overflow-x-auto lg:flex-col lg:overflow-visible">
          {revision.chapters.map((c) => (
            <Link
              key={c.id}
              href={hrefOf(c.code)}
              aria-current={c.code === chapter.code ? "page" : undefined}
              className={cn(
                "grid min-h-10 flex-none grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2 rounded-[9px] border-l-[3px] border-transparent px-2.5 text-[13.5px] hover:bg-raise lg:flex-auto",
                c.code === chapter.code && "border-l-primary bg-brand-soft font-semibold",
              )}
            >
              <span className="num text-muted-foreground">{c.code}</span>
              <span className="hidden truncate lg:block">{c.name}</span>
              <span className="num hidden text-xs text-muted-foreground lg:block">{f.money(c.totalCents)}</span>
            </Link>
          ))}
          <span className="my-1.5 hidden border-t lg:block" />
          <Link href={optionsHref} className="grid min-h-10 flex-none grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-2 rounded-[9px] px-2.5 text-[13.5px] hover:bg-raise lg:flex-auto">
            <span className="num text-muted-foreground">OP</span>
            <span className="hidden truncate lg:block">{t("options")}</span>
            <span className="num hidden text-xs text-muted-foreground lg:block">{revision.options.length}</span>
          </Link>
        </div>
      </nav>

      <section className={cn(cardVariants(), "min-w-0 flex-1")} aria-labelledby="chapter-title">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex items-center gap-2.5">
              <span className={codeChip}>{chapter.code}</span>
              {editable ? (
                <SaveOnBlur key={chapter.id + chapter.name} label={t("name")} value={chapter.name} onSave={(name) => handlers.onRename(chapter, name)} className="h-9 min-w-[260px] font-heading text-xl font-bold" />
              ) : (
                <h2 id="chapter-title">{chapter.name}</h2>
              )}
            </div>
            <p className={muted}>
              {t("stats", { count: chapter.lineCount, share: f.share(chapter.shareBp) })}
              {perM2Cents !== null && ` · ${t("perM2", { amount: f.money(perM2Cents) })}`}
              {average ? <span className={cn(offAverage && "text-warn")}> {t("average", { amount: f.money(average) })}</span> : null}
            </p>
          </div>
          <span className="num text-[22px] font-semibold">{f.money(chapter.totalCents)}</span>
        </div>

        {!computed && (
          <label className="flex flex-col gap-1.5 text-[12.5px] font-semibold text-muted-foreground">
            <span>
              {t("note")} <span className="font-normal">{t("noteHint")}</span>
            </span>
            <SaveOnBlur key={chapter.id + (chapter.pdfNote ?? "")} label={t("note")} multiline rows={2} value={chapter.pdfNote ?? ""} onSave={editable ? (note) => handlers.onNote(chapter, note) : undefined} />
          </label>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("filter")}>
            {(["all", "estimated", "noted"] as const).map((key) => (
              <button
                key={key}
                type="button"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                className={chip}
              >
                {t(`filters.${key}`, { count: counts[key] })}
              </button>
            ))}
          </div>
          {editable && (
            <PriceBaseButton
              label={t("add")}
              chapter={chapter.code}
              onSearch={handlers.onSearch}
              onPick={(item) => handlers.onAddFromBase(chapter, item)}
              onFree={() => handlers.onAddFree(chapter)}
              freeLabel={t("addFree")}
            />
          )}
        </div>

        {computed && <p className={muted}>{t("computed", { pct: f.share(revision.contingencyBp) })}</p>}
        <LineTable label={`${chapter.code} ${chapter.name}`} lines={shown} onUpdate={editable ? handlers.onUpdate : undefined} menuFor={editable ? menuFor : undefined} />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={muted}>{editable ? t("saveHint") : ""}</span>
          <strong className="text-sm">{t("subtotal", { code: chapter.code, amount: f.money(chapter.totalCents) })}</strong>
        </div>
      </section>
    </div>
  );
}
