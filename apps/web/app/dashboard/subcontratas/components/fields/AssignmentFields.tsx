"use client";

import { useTranslations } from "next-intl";
import type { ProjectOption } from "@repo/core/contract";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toggle, type AssignmentValues } from "./draft";
import ToggleChip from "./ToggleChip";

/**
 * Presentational: what a company does on an obra — the budget chapters it
 * executes, its planned dates and its entry in the Libro de Subcontratación.
 * Shared by the registration wizard and the ficha's Obras tab.
 */
export default function AssignmentFields({
  idPrefix,
  chapters,
  values,
  onChange,
}: {
  /** Keeps the inputs' ids unique on the page. */
  idPrefix: string;
  chapters: ProjectOption["chapters"];
  values: AssignmentValues;
  onChange: (patch: Partial<AssignmentValues>) => void;
}) {
  const t = useTranslations("subcontractors.fields.assignment");
  const id = (name: string) => `${idPrefix}-${name}`;

  return (
    <div className="flex flex-col gap-4">
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 flex flex-wrap items-baseline gap-x-2.5 text-sm font-semibold">
          {t("chapters")}
          <span className="text-xs font-normal text-muted-foreground">{t("chaptersHint")}</span>
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {chapters.map((chapter) => (
            <ToggleChip
              key={chapter.code}
              on={values.chapterCodes.includes(chapter.code)}
              onToggle={() => onChange({ chapterCodes: toggle(values.chapterCodes, chapter.code).sort() })}
            >
              <span className="num">{chapter.code}</span>
              {chapter.name}
            </ToggleChip>
          ))}
        </div>
      </fieldset>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field>
          <Label htmlFor={id("start")}>{t("plannedStart")}</Label>
          <Input id={id("start")} type="date" value={values.plannedStart} onChange={(e) => onChange({ plannedStart: e.target.value })} />
        </Field>
        <Field>
          <Label htmlFor={id("end")}>{t("plannedEnd")}</Label>
          <Input
            id={id("end")}
            type="date"
            min={values.plannedStart || undefined}
            value={values.plannedEnd}
            onChange={(e) => onChange({ plannedEnd: e.target.value })}
          />
        </Field>
      </div>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 flex flex-wrap items-baseline gap-x-2.5 text-sm font-semibold">
          {t("book")}
          <span className="text-xs font-normal text-muted-foreground">
            {t("bookHint")} · <span className="num">libro_subcontratacion</span>
          </span>
        </legend>
        <div className="grid gap-3 sm:grid-cols-3 sm:items-end">
          <Field>
            <Label htmlFor={id("book-order")}>{t("bookOrder")}</Label>
            <Input
              id={id("book-order")}
              type="number"
              min={1}
              inputMode="numeric"
              className="num"
              value={values.bookOrder}
              onChange={(e) => onChange({ bookOrder: e.target.value })}
            />
          </Field>
          <Field>
            <Label htmlFor={id("book-date")}>{t("bookDate")}</Label>
            <Input id={id("book-date")} type="date" value={values.bookDate} onChange={(e) => onChange({ bookDate: e.target.value })} />
          </Field>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm font-medium">
            <input
              type="checkbox"
              className="size-[18px] accent-primary"
              checked={values.cssInformed}
              onChange={(e) => onChange({ cssInformed: e.target.checked })}
            />
            {t("cssInformed")}
          </label>
        </div>
      </fieldset>
    </div>
  );
}
