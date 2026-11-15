"use client";

// Container for Elementos eliminados: what users deleted, for an admin to
// restore. The only file here that calls server actions: it keeps the list
// (the filters and "Cargar más" ask the server for a page) and restores a
// record once the dialog confirms. The views in ./components take props only.

import { useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { MAX_PAGE_SIZE, type DeletedFilters, type DeletedItem, type DeletedList } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { FormMessage } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { listDeletedAction, restoreDeletedAction } from "../../actions/deleted";
import FormError from "../components/FormError";
import { useConfirm } from "../components/useConfirm";
import { DeletedFilterBar, DeletedIntro, DeletedTable, type DeletedFilterValue } from "./components/DeletedViews";
import { useDeletedText } from "./components/text";

/** What a reload after a restore asks for at most: the most the server answers at once. */
const MAX_RELOAD = MAX_PAGE_SIZE;

const same = (a: DeletedItem, b: DeletedItem) => a.kind === b.kind && a.id === b.id;

export default function EliminadosScreen({ initial }: { initial: DeletedList }) {
  const t = useTranslations("deletedPage");
  const text = useDeletedText();
  const [list, setList] = useState({ items: initial.items, nextCursor: initial.nextCursor });
  const [projects, setProjects] = useState(initial.projects ?? []);
  const [filters, setFilters] = useState<DeletedFilterValue>({ kind: "", projectId: "" });
  const [listError, setListError] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const tc = useTranslations("deletedPage.confirm");
  const confirm = useConfirm("deletedPage.errors");
  const [restored, setRestored] = useState<string | null>(null);
  // Only the last request's answer is shown: a slow page never overwrites a newer filter.
  const request = useRef(0);

  const queryOf = (value: DeletedFilterValue): DeletedFilters => ({
    ...(value.kind ? { kind: value.kind } : {}),
    ...(value.projectId ? { projectId: value.projectId } : {}),
  });

  /** Asks for a page and shows it: appended after the list ("Cargar más"), else in its place. */
  async function load(query: DeletedFilters, { append = false } = {}) {
    const id = ++request.current;
    const result = await listDeletedAction(query);
    if (id !== request.current) return;
    if (result.error) return setListError(result.error);
    setListError(null);
    setList((current) => ({
      items: append ? [...current.items, ...result.data.items.filter((item) => !current.items.some((shown) => same(shown, item)))] : result.data.items,
      nextCursor: result.data.nextCursor,
    }));
    if (result.data.projects) setProjects(result.data.projects);
  }

  function changeFilters(next: DeletedFilterValue) {
    setFilters(next);
    setRestored(null);
    startLoading(async () => {
      await load(queryOf(next));
    });
  }

  function loadMore() {
    const cursor = list.nextCursor;
    if (!cursor) return;
    startLoading(async () => {
      await load({ ...queryOf(filters), cursor }, { append: true });
    });
  }

  /** Asks first; the dialog restores `item` and shows why it couldn't. */
  function open(item: DeletedItem) {
    confirm.ask({
      title: tc("title", { item: text.title(item) }),
      description: tc(`description.${item.kind}`),
      confirmLabel: tc("confirm"),
      pendingLabel: tc("restoring"),
      action: () => restoreDeletedAction(item.kind, item.id),
      onDone: () => afterRestore(item),
    });
  }

  function afterRestore(item: DeletedItem) {
    setRestored(text.title(item));
    const shown = list.items.length;
    // Gone from the list at once; then read again: what hung from it can now be restored too.
    setList((current) => ({ ...current, items: current.items.filter((other) => !same(other, item)) }));
    startLoading(async () => {
      await load({ ...queryOf(filters), limit: Math.min(Math.max(shown, 1), MAX_RELOAD) });
    });
  }

  const filtered = filters.kind !== "" || filters.projectId !== "";

  return (
    <div className="flex flex-col gap-[18px]">
      <DeletedIntro />

      <section className={cn(cardVariants({ size: "flush" }), "pt-4 pb-1.5")} aria-labelledby="deleted-title" aria-busy={loading}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2.5 px-[18px] pb-3.5">
          <h2 id="deleted-title" className="mr-1.5 text-[22px]">
            {t("listTitle")}
          </h2>
          <DeletedFilterBar value={filters} projects={projects} onChange={changeFilters} />
        </div>
        {restored && (
          <FormMessage tone="success" role="status" className="px-[18px] pb-3">
            {t("restored", { item: restored })}
          </FormMessage>
        )}
        {listError && (
          <div className="px-[18px] pb-3">
            <FormError namespace="deletedPage.errors" error={listError} />
          </div>
        )}
        <DeletedTable items={list.items} empty={filtered ? t("noMatch") : t("empty")} onRestore={open} />
        {list.nextCursor && (
          <div className="flex justify-center border-t px-[18px] py-3">
            <Button type="button" variant="outline" onClick={loadMore} disabled={loading} className="w-full sm:w-auto">
              {loading ? t("loading") : t("loadMore")}
            </Button>
          </div>
        )}
      </section>

      {confirm.dialog}
    </div>
  );
}
