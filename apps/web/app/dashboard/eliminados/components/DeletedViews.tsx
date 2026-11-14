"use client";

import { useTranslations } from "next-intl";
import { ArchiveRestore } from "lucide-react";
import { DELETED_KINDS, type DeletedItem, type DeletedKind, type DeletedProjectOption } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FilterSelect } from "../../projects/[id]/components/construction/Filters";
import { useDeletedText } from "./text";

// Presentational: the page of what users deleted. The container
// (../EliminadosScreen) loads, filters and restores; these take props only.

export type DeletedFilterValue = { kind: DeletedKind | ""; projectId: string };

/** What the page is: nothing is erased, and here it comes back. */
export function DeletedIntro() {
  const t = useTranslations("deletedPage");
  return (
    <header className="min-w-0">
      <span className="eyebrow">{t("eyebrow")}</span>
      <h1 className="mt-1.5">{t("title")}</h1>
      <p className="mt-1 max-w-[640px] text-[14px] text-muted-foreground">{t("intro")}</p>
    </header>
  );
}

/** By kind of record and by obra (the ones with deleted records, a deleted obra among them). */
export function DeletedFilterBar({
  value,
  projects,
  onChange,
}: {
  value: DeletedFilterValue;
  projects: DeletedProjectOption[];
  onChange: (value: DeletedFilterValue) => void;
}) {
  const t = useTranslations("deletedPage");
  return (
    <>
      <FilterSelect
        id="deleted-kind"
        label={t("filters.kind")}
        value={value.kind}
        onChange={(kind) => onChange({ ...value, kind: kind as DeletedKind | "" })}
        options={[{ value: "", label: t("filters.allKinds") }, ...DELETED_KINDS.map((kind) => ({ value: kind, label: t(`kinds.${kind}`) }))]}
      />
      <FilterSelect
        id="deleted-project"
        label={t("filters.project")}
        value={value.projectId}
        onChange={(projectId) => onChange({ ...value, projectId })}
        options={[
          { value: "", label: t("filters.allProjects") },
          ...projects.map((p) => ({ value: p.id, label: p.deleted ? t("filters.deletedProject", { ref: p.ref }) : p.ref })),
        ]}
      />
    </>
  );
}

const KindPill = ({ item }: { item: DeletedItem }) => {
  const text = useDeletedText();
  return <Badge variant={item.kind === "project" ? "default" : "outline"}>{text.kind(item)}</Badge>;
};

/** "Restaurar", or why not yet. */
function RestoreCell({ item, onRestore, className }: { item: DeletedItem; onRestore: (item: DeletedItem) => void; className?: string }) {
  const t = useTranslations("deletedPage");
  const text = useDeletedText();
  const blocked = text.blocked(item);
  if (blocked) return <p className={className ?? "ml-auto max-w-[260px] text-left text-[12.5px] whitespace-normal text-muted-foreground"}>{blocked}</p>;
  return (
    <Button type="button" variant="outline" size="sm" onClick={() => onRestore(item)} aria-label={t("restoreItem", { item: text.title(item) })}>
      <ArchiveRestore aria-hidden />
      {t("restore")}
    </Button>
  );
}

/**
 * The deleted records, newest deletion first: a table from 768px, cards on a
 * phone. A row that can be restored has its button; one that can't says why.
 */
export function DeletedTable({ items, empty, onRestore }: { items: DeletedItem[]; empty: string; onRestore: (item: DeletedItem) => void }) {
  const t = useTranslations("deletedPage");
  const text = useDeletedText();
  if (items.length === 0) return <p className="px-[18px] py-10 text-center text-[13.5px] text-muted-foreground">{empty}</p>;
  const key = (item: DeletedItem) => `${item.kind}:${item.id}`;

  return (
    <>
      <div className="hidden px-[18px] pb-1.5 md:block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("cols.kind")}</TableHead>
              <TableHead>{t("cols.what")}</TableHead>
              <TableHead>{t("cols.project")}</TableHead>
              <TableHead>{t("cols.deleted")}</TableHead>
              <TableHead>
                <span className="sr-only">{t("cols.actions")}</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.map((item) => {
              const detail = text.detail(item);
              return (
                <TableRow key={key(item)}>
                  <TableCell>
                    <KindPill item={item} />
                  </TableCell>
                  <TableCell className="max-w-[340px] whitespace-normal">
                    <span className="font-medium break-words">{text.title(item)}</span>
                    {detail && <span className="block text-[12.5px] break-words text-muted-foreground">{detail}</span>}
                  </TableCell>
                  <TableCell className="num font-semibold">{item.projectRef}</TableCell>
                  <TableCell>
                    <time dateTime={item.deletedAt} className="num">
                      {text.when(item)}
                    </time>
                    <span className="block text-[12.5px] text-muted-foreground">{text.by(item)}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <RestoreCell item={item} onRestore={onRestore} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ul className="m-0 flex list-none flex-col p-0 md:hidden">
        {items.map((item) => {
          const detail = text.detail(item);
          return (
            <li key={key(item)} className="flex flex-col gap-2 border-b px-[18px] py-3.5 last:border-b-0">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <KindPill item={item} />
                <span className="num text-[12.5px] font-semibold">{item.projectRef}</span>
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium break-words">{text.title(item)}</span>
                {detail && <span className="block text-[13px] break-words text-muted-foreground">{detail}</span>}
              </span>
              <span className="text-[12.5px] text-muted-foreground">
                <time dateTime={item.deletedAt} className="num">
                  {text.when(item)}
                </time>{" "}
                · {text.by(item)}
              </span>
              <RestoreCell item={item} onRestore={onRestore} className="text-[12.5px] text-muted-foreground" />
            </li>
          );
        })}
      </ul>
    </>
  );
}
