"use client";

import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BudgetChapter, BudgetLine, BudgetRevision } from "@repo/core/contract";
import { useObraFormat } from "./format";
import InlineNumber from "./InlineNumber";
import styles from "./obra.module.css";
import { columns } from "./table";

const COLUMNS = "64px minmax(0, 1fr) 48px 100px 110px 120px 88px";

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
    <div>
      {revision.chapters.map((chapter) => {
        const isOpen = open.has(chapter.code);
        return (
          <div key={chapter.id}>
            <button
              type="button"
              className={`${styles.chapterHead} ${isOpen ? styles.chapterOpen : ""}`}
              aria-expanded={isOpen}
              onClick={() => onToggle(chapter.code)}
            >
              {isOpen ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
              <span className={styles.code}>{chapter.code}</span>{" "}
              <span className={styles.chapterName}>
                {chapter.name}
                {chapter.change && <span className={styles.flag}> {t(`flags.${chapter.change}`)}</span>}
              </span>{" "}
              <span className={styles.muted}>
                {t("lineCount", { count: chapter.lines.length })} · {f.share(chapter.shareBp)}
              </span>{" "}
              <span className={`${styles.num} ${styles.strong}`}>{f.money(chapter.totalCents)}</span>
            </button>
            {isOpen && (
              <div className={styles.chapterBody}>
                {chapter.changeNote && <p className={styles.note}>{chapter.changeNote}</p>}
                <div
                  role="table"
                  aria-label={`${chapter.code} ${chapter.name}`}
                  className={styles.table}
                  style={columns(COLUMNS)}
                >
                  <div role="row" className={styles.headRow}>
                    <span role="columnheader">{t("codeCol")}</span>
                    <span role="columnheader">{t("descriptionCol")}</span>
                    <span role="columnheader">{t("unitCol")}</span>
                    <span role="columnheader" className={styles.right}>{t("qtyCol")}</span>
                    <span role="columnheader" className={styles.right}>{t("priceCol")}</span>
                    <span role="columnheader" className={styles.right}>{t("amountCol")}</span>
                    <span role="columnheader" />
                  </div>
                  {chapter.lines.map((line) => (
                    <div role="row" key={line.id} className={styles.row}>
                      <span role="cell" className={`${styles.num} ${styles.muted}`}>{line.code}</span>
                      <span role="cell" className={styles.rowName}>{line.description}</span>
                      <span role="cell" className={styles.muted}>{line.unit}</span>
                      <span role="cell" className={`${styles.num} ${styles.right}`}>
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
                      <span role="cell" className={`${styles.num} ${styles.right}`}>
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
                      <span role="cell" className={`${styles.num} ${styles.right} ${styles.strong}`}>
                        {f.decimal(line.amountCents / 100)}
                      </span>
                      <span role="cell" className={styles.buttons}>
                        {handlers && (
                          <>
                            <button type="button" className={styles.textButton} aria-label={t("editLine", { code: line.code })} onClick={() => handlers.onEditLine(chapter, line)}>
                              <Pencil size={14} aria-hidden />
                            </button>
                            <button type="button" className={styles.dangerText} aria-label={t("deleteLine", { code: line.code })} onClick={() => handlers.onDeleteLine(line)}>
                              <Trash2 size={14} aria-hidden />
                            </button>
                          </>
                        )}
                      </span>
                    </div>
                  ))}
                </div>
                <div className={styles.subtotal}>
                  {handlers && (
                    <span className={styles.buttons}>
                      <button type="button" className={styles.textButton} onClick={() => handlers.onAddLine(chapter)}>
                        <span aria-hidden>+ </span>
                        {t("addLine")}
                      </button>
                      <button type="button" className={styles.textButton} onClick={() => handlers.onEditChapter(chapter)}>
                        {t("editChapter")}
                      </button>
                      <button type="button" className={styles.dangerText} onClick={() => handlers.onDeleteChapter(chapter)}>
                        {t("deleteChapter")}
                      </button>
                    </span>
                  )}
                  <strong>{t("subtotal", { code: chapter.code, amount: f.money(chapter.totalCents) })}</strong>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
