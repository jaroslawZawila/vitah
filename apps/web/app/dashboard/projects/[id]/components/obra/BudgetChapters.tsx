"use client";

import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BudgetChapter, BudgetLine, BudgetRevision } from "@repo/core/contract";
import { useObraFormat } from "./format";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { codeChip, columns, table } from "./classes";
import InlineNumber from "./InlineNumber";

const COLUMNS = "64px minmax(160px, 1fr) 48px 100px 110px 120px 88px";

type Handlers = {
  onAddLine: (chapter: BudgetChapter) => void;
  onEditChapter: (chapter: BudgetChapter) => void;
  onDeleteChapter: (chapter: BudgetChapter) => void;
  onEditLine: (chapter: BudgetChapter, line: BudgetLine) => void;
  onDeleteLine: (line: BudgetLine) => void;
  onUpdateLine: (line: BudgetLine, changes: { quantity?: number; unitPriceCents?: number }) => void;
};

/**
 * Presentational: the revision's chapters, each opening to its lines. On a
 * draft (`handlers` set) lines are edited in place.
 */
export default function BudgetChapters({
  revision,
  open,
  onToggle,
  handlers,
}: {
  revision: BudgetRevision;
  open: Set<string>;
  onToggle: (code: string) => void;
  /** Omitted when the revision can't be edited. */
  handlers?: Handlers;
}) {
  const t = useTranslations("obra.budget");
  const f = useObraFormat();

  return (
    <div className="flex flex-col gap-2">
      {revision.chapters.map((chapter) => {
        const isOpen = open.has(chapter.code);
        return (
          <div key={chapter.id} className="overflow-hidden rounded-[12px] border bg-card">
            <button
              type="button"
              className={cn(
                "flex min-h-12 w-full cursor-pointer flex-wrap items-center gap-x-3.5 gap-y-1 px-3.5 py-3 text-left text-[13.5px] transition-colors hover:bg-raise",
                isOpen && "border-b bg-raise",
              )}
              aria-expanded={isOpen}
              onClick={() => onToggle(chapter.code)}
            >
              {isOpen ? (
                <ChevronDown size={16} className="text-muted-foreground" aria-hidden />
              ) : (
                <ChevronRight size={16} className="text-muted-foreground" aria-hidden />
              )}
              <span className={codeChip}>
                {chapter.code}
              </span>{" "}
              <span className="flex-[1_1_200px] text-sm font-semibold">
                {chapter.name}
                {chapter.change && <span className="text-[11.5px] font-semibold text-brand-ink"> {t(`flags.${chapter.change}`)}</span>}
              </span>{" "}
              <span className="text-xs text-muted-foreground">
                {t("lineCount", { count: chapter.lines.length })} · {f.share(chapter.shareBp)}
              </span>{" "}
              <span className="num font-semibold">{f.money(chapter.totalCents)}</span>
            </button>
            {isOpen && (
              <div className="flex flex-col gap-3.5 p-3.5">
                {chapter.changeNote && <p className="rounded-lg bg-raise px-[13px] py-2.5 text-[13px] text-muted-foreground">{chapter.changeNote}</p>}
                <div
                  role="table"
                  aria-label={`${chapter.code} ${chapter.name}`}
                  className={table.root}
                  style={columns(COLUMNS)}
                >
                  <div role="row" className={table.head}>
                    <span role="columnheader">{t("codeCol")}</span>
                    <span role="columnheader">{t("descriptionCol")}</span>
                    <span role="columnheader">{t("unitCol")}</span>
                    <span role="columnheader" className={table.right}>{t("qtyCol")}</span>
                    <span role="columnheader" className={table.right}>{t("priceCol")}</span>
                    <span role="columnheader" className={table.right}>{t("amountCol")}</span>
                    <span role="columnheader" />
                  </div>
                  {chapter.lines.map((line) => (
                    <div role="row" key={line.id} className={table.row}>
                      <span role="cell" className="num text-muted-foreground">{line.code}</span>
                      <span role="cell" className={table.name}>{line.description}</span>
                      <span role="cell" className="text-muted-foreground">{line.unit}</span>
                      <span role="cell" className={`num ${table.right}`}>
                        {handlers ? (
                          <InlineNumber
                            // A new saved value resets what was typed.
                            key={line.quantity}
                            label={t("qtyLabel", { code: line.code })}
                            display={f.quantity(line.quantity)}
                            parse={f.parse}
                            onCommit={(quantity) => handlers.onUpdateLine(line, { quantity })}
                          />
                        ) : (
                          f.quantity(line.quantity)
                        )}
                      </span>
                      <span role="cell" className={`num ${table.right}`}>
                        {handlers ? (
                          <InlineNumber
                            key={line.unitPriceCents}
                            label={t("priceLabel", { code: line.code })}
                            display={f.decimal(line.unitPriceCents / 100)}
                            parse={(text) => {
                              const cents = f.hundredths(text);
                              return Number.isNaN(cents) ? null : cents;
                            }}
                            onCommit={(unitPriceCents) => handlers.onUpdateLine(line, { unitPriceCents })}
                          />
                        ) : (
                          f.decimal(line.unitPriceCents / 100)
                        )}
                      </span>
                      <span role="cell" className={`num font-semibold ${table.right}`}>
                        {f.decimal(line.amountCents / 100)}
                      </span>
                      <span role="cell" className="flex flex-wrap justify-end gap-0.5">
                        {handlers && (
                          <>
                            <Button type="button" variant="ghost" size="icon-sm" aria-label={t("editLine", { code: line.code })} onClick={() => handlers.onEditLine(chapter, line)}>
                              <Pencil aria-hidden />
                            </Button>
                            <Button type="button" variant="ghost" size="icon-sm" className="hover:text-bad" aria-label={t("deleteLine", { code: line.code })} onClick={() => handlers.onDeleteLine(line)}>
                              <Trash2 aria-hidden />
                            </Button>
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {handlers && (
                    <span className="flex flex-wrap gap-1">
                      <Button type="button" variant="outline" size="sm" onClick={() => handlers.onAddLine(chapter)}>
                        <span aria-hidden>+ </span>
                        {t("addLine")}
                      </Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => handlers.onEditChapter(chapter)}>
                        {t("editChapter")}
                      </Button>
                      <Button type="button" variant="ghost-destructive" size="sm" onClick={() => handlers.onDeleteChapter(chapter)}>
                        {t("deleteChapter")}
                      </Button>
                    </span>
                  )}
                  <strong className="ml-auto text-[13.5px] font-semibold">{t("subtotal", { code: chapter.code, amount: f.money(chapter.totalCents) })}</strong>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
