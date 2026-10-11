"use client";

import { useState } from "react";
import { MoreHorizontal } from "lucide-react";
import { useTranslations } from "next-intl";
import type { BudgetChapter, BudgetLine, BudgetOption, PriceBaseItem } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { columns, table } from "../obra/classes";
import { useObraFormat } from "../obra/format";
import InlineNumber from "../obra/InlineNumber";
import Popover from "./Popover";

const COLUMNS = "64px minmax(200px, 1fr) 44px 104px 112px 112px 44px";

export type MenuItem = { label: string; onSelect: () => void; destructive?: boolean };

/** What lines belong to: a chapter or an option. */
export type LineParent = BudgetChapter | BudgetOption;

/** What can be done to lines, a chapter's or an option's alike. */
export type LineOps = {
  onAddFromBase: (parent: LineParent, item: PriceBaseItem) => void;
  onAddFree: (parent: LineParent) => void;
  onUpdate: (line: BudgetLine, changes: { quantity?: number; unitPriceCents?: number }) => void;
  onEdit: (parent: LineParent, line: BudgetLine) => void;
  onDelete: (line: BudgetLine) => void;
  onSearch: (query: string, chapter?: string) => Promise<PriceBaseItem[]>;
};

/**
 * Presentational: lines with quantity and price edited in place (`onUpdate`,
 * drafts) and a menu per line (`menuFor`). Chapter 20's computed line is read-only.
 */
export default function LineTable({
  label,
  lines,
  onUpdate,
  menuFor,
}: {
  label: string;
  lines: BudgetLine[];
  onUpdate?: (line: BudgetLine, changes: { quantity?: number; unitPriceCents?: number }) => void;
  menuFor?: (line: BudgetLine) => MenuItem[];
}) {
  const t = useTranslations("budget.lines");
  const f = useObraFormat();
  const [menu, setMenu] = useState<string | null>(null);
  const priceParse = (text: string) => {
    const cents = f.signedHundredths(text);
    return Number.isNaN(cents) ? null : cents;
  };

  return (
    <div role="table" aria-label={label} className={table.root} style={columns(COLUMNS)}>
      <div role="row" className={table.head}>
        <span role="columnheader">{t("code")}</span>
        <span role="columnheader">{t("description")}</span>
        <span role="columnheader">{t("unit")}</span>
        <span role="columnheader" className={table.right}>{t("quantity")}</span>
        <span role="columnheader" className={table.right}>{t("price")}</span>
        <span role="columnheader" className={table.right}>{t("amount")}</span>
        <span role="columnheader" />
      </div>
      {lines.map((line) => {
        const editable = onUpdate && line.source !== "computed";
        const items = line.source === "computed" ? [] : (menuFor?.(line) ?? []);
        return (
          <div role="row" key={line.id} className={table.row}>
            <span role="cell" className="num text-muted-foreground md:self-start md:pt-1.5">{line.code}</span>
            <span role="cell" className={cn(table.name, "flex flex-col gap-1")}>
              <span>{line.description}</span>
              {line.note && <span className="rounded-md bg-raise px-2 py-1 text-[12.5px] font-normal text-muted-foreground">{line.note}</span>}
              {line.source === "estimated" && <Badge variant="yel">{t("estimated")}</Badge>}
            </span>
            <span role="cell" className="text-muted-foreground">{line.unit}</span>
            <span role="cell" className={`num ${table.right}`}>
              {editable ? (
                <InlineNumber key={line.quantity} label={t("quantityLabel", { code: line.code })} display={f.quantity(line.quantity)} parse={f.parse} onCommit={(quantity) => onUpdate(line, { quantity })} />
              ) : (
                f.quantity(line.quantity)
              )}
            </span>
            <span role="cell" className={`num ${table.right}`}>
              {editable ? (
                <InlineNumber key={line.unitPriceCents} label={t("priceLabel", { code: line.code })} display={f.decimal(line.unitPriceCents / 100)} parse={priceParse} onCommit={(unitPriceCents) => onUpdate(line, { unitPriceCents })} />
              ) : (
                f.decimal(line.unitPriceCents / 100)
              )}
            </span>
            <span role="cell" className={`num font-semibold ${table.right}`}>{f.decimal(line.amountCents / 100)}</span>
            <span role="cell" className="relative flex justify-end">
              {items.length > 0 && (
                <>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("menu", { code: line.code })} aria-expanded={menu === line.id} onClick={() => setMenu(menu === line.id ? null : line.id)}>
                    <MoreHorizontal aria-hidden />
                  </Button>
                  <Popover open={menu === line.id} onClose={() => setMenu(null)} label={t("menu", { code: line.code })} className="w-[290px] p-1.5">
                    {items.map((item) => (
                      <button
                        key={item.label}
                        type="button"
                        className={cn("flex min-h-10 items-center rounded-lg px-2.5 text-left text-sm hover:bg-raise", item.destructive && "text-destructive")}
                        onClick={() => {
                          setMenu(null);
                          item.onSelect();
                        }}
                      >
                        {item.label}
                      </button>
                    ))}
                  </Popover>
                </>
              )}
            </span>
          </div>
        );
      })}
    </div>
  );
}
