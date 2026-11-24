"use client";

import { useState } from "react";
import { BookmarkPlus, Pencil, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { exclusionChecklist, MAX_EXCLUSION_TEXT, type ExclusionPreset } from "@repo/core/contract";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { muted } from "../obra/classes";
import SaveOnBlur from "./SaveOnBlur";

/** What a draft's checklist does; the library's own lines are changed by admins and managers only. */
export type ExclusionHandlers = {
  /** Ticks a line on this budget or off it; `save` also keeps it in the library; `onDone` once it is saved. */
  onTick: (text: string, included: boolean, save?: boolean, onDone?: () => void) => void;
  /** One of this budget's own lines, edited in its place. */
  onEdit: (line: string, text: string) => void;
  /** A library line renamed; this budget, if it has the line, follows (other budgets keep theirs). */
  onRenamePreset: (preset: ExclusionPreset, label: string) => void;
  onDeletePreset: (preset: ExclusionPreset) => void;
};

const row = "flex items-start gap-2.5 border-t py-1.5";
const box = "size-[18px] flex-none accent-primary";

/**
 * Presentational: the budget's "Gastos no incluidos". On a draft, a checklist:
 * every line of the company's library with a tick box (ticked: this budget
 * excludes it, and the PDFs print it), then the lines of this budget only,
 * and a field to add one, also to the library if asked. Without `handlers`
 * (viewers, issued revisions) just the lines that apply, numbered.
 */
export default function ExclusionChecklist({
  exclusions,
  library,
  handlers,
}: {
  /** The budget's lines, in the PDF's order. */
  exclusions: string[];
  library: ExclusionPreset[];
  handlers?: ExclusionHandlers;
}) {
  const t = useTranslations("budget.conditions");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [save, setSave] = useState(false);

  if (!handlers) {
    if (exclusions.length === 0) return <p className={muted}>{t("noExclusions")}</p>;
    return (
      <ol className="flex flex-col">
        {exclusions.map((item, i) => (
          <li key={`${i}-${item}`} className="flex items-start gap-2.5 border-t py-2 text-sm">
            <span className="num text-muted-foreground">{i + 1}</span>
            <span className="min-w-0 flex-1 whitespace-pre-line">{item}</span>
          </li>
        ))}
      </ol>
    );
  }

  const checklist = exclusionChecklist(exclusions, library);
  const add = (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    // Emptied once saved: a refusal (a list full) leaves what was typed.
    handlers.onTick(text, true, save, () => {
      setDraft("");
      setSave(false);
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className={muted}>{t("exclusionsHint")}</p>
      <div className="flex flex-col">
        <p className="eyebrow pb-1.5">{t("library")}</p>
        {checklist.library.length === 0 && <p className={cn(muted, "border-t py-2")}>{t("emptyLibrary")}</p>}
        <ul className="flex flex-col">
          {checklist.library.map(({ preset, included }, i) => (
            <li key={preset.id} className={row}>
              {editing === preset.id ? (
                // Leaving the field ends the edit (saved if it changed).
                <div className="flex-1" onBlur={() => setEditing(null)}>
                  <SaveOnBlur
                    label={t("presetLabel", { n: i + 1 })}
                    value={preset.label}
                    multiline
                    rows={2}
                    autoFocus
                    onSave={(label) => label && handlers.onRenamePreset(preset, label)}
                  />
                </div>
              ) : (
                <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2.5 py-1 text-sm pointer-coarse:min-h-11">
                  <input type="checkbox" className={cn(box, "mt-0.5")} checked={included} onChange={(event) => handlers.onTick(preset.label, event.target.checked)} />
                  <span className={cn("min-w-0 flex-1", !included && "text-muted-foreground")}>{preset.label}</span>
                </label>
              )}
              <span className="flex flex-none">
                {/* While editing, leaving the field closes it: no second way that would race the blur. */}
                {editing !== preset.id && (
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("editPreset", { n: i + 1 })} onClick={() => setEditing(preset.id)}>
                    <Pencil aria-hidden />
                  </Button>
                )}
                <Button type="button" variant="ghost" size="icon-sm" className="hover:text-bad" aria-label={t("removePreset", { n: i + 1 })} onClick={() => handlers.onDeletePreset(preset)}>
                  <Trash2 aria-hidden />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      </div>

      {checklist.extra.length > 0 && (
        <div className="flex flex-col">
          <p className="eyebrow pb-1.5">{t("own")}</p>
          <ol className="flex flex-col">
            {checklist.extra.map((item, i) => (
              <li key={`${i}-${item}`} className={row}>
                <SaveOnBlur
                  label={t("exclusion", { n: i + 1 })}
                  value={item}
                  multiline
                  rows={2}
                  className="flex-1"
                  onSave={(value) => (value ? handlers.onEdit(item, value) : handlers.onTick(item, false))}
                />
                <span className="flex flex-none">
                  <Button type="button" variant="ghost" size="icon-sm" aria-label={t("saveOwn", { n: i + 1 })} title={t("saveForOthers")} onClick={() => handlers.onTick(item, true, true)}>
                    <BookmarkPlus aria-hidden />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" className="hover:text-bad" aria-label={t("removeExclusion", { n: i + 1 })} onClick={() => handlers.onTick(item, false)}>
                    <Trash2 aria-hidden />
                  </Button>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}

      <form className="flex flex-col gap-2 border-t pt-3" onSubmit={add}>
        <Textarea aria-label={t("newExclusion")} placeholder={t("newExclusion")} rows={2} maxLength={MAX_EXCLUSION_TEXT} value={draft} onChange={(event) => setDraft(event.target.value)} />
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm pointer-coarse:min-h-11">
            <input type="checkbox" className={box} checked={save} onChange={(event) => setSave(event.target.checked)} />
            {t("saveForOthers")}
          </label>
          <Button type="submit" variant="outline" size="sm" disabled={!draft.trim()}>
            + {t("addExclusion")}
          </Button>
        </div>
      </form>
    </div>
  );
}
