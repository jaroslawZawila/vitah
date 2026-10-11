"use client";

import { ArrowDown, ArrowUp, FileText, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { ANNEX_KINDS, checkKey, type BudgetRevision, type BudgetTexts, type ProjectDocument } from "@repo/core/contract";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cardVariants } from "@/components/ui/card";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { cardHead, muted } from "../obra/classes";
import { moveItem, removeAt, replaceAt } from "./lists";
import SaveOnBlur from "./SaveOnBlur";

type Annex = BudgetTexts["annex"];
type Blocks = BudgetTexts["justification"]["blocks"];
const COVER_FIELDS = ["promoter", "site", "cadastral", "surfaces", "program", "basis", "scope", "system"] as const;
const LONG = new Set(["program", "basis", "scope", "system"]);

/**
 * Presentational: the texts the PDFs print besides numbers: the cover table,
 * the technical justification, the measurement criterion and the annex of
 * observations (written by the AI, edited here). `onSave` (drafts) takes a
 * partial `texts`; whole lists are replaced.
 */
export default function TextsView({
  revision,
  inputs,
  fileUrl,
  onSave,
}: {
  revision: BudgetRevision;
  inputs: ProjectDocument[];
  fileUrl: (document: ProjectDocument) => string;
  onSave?: (texts: Partial<BudgetTexts>) => void;
}) {
  const t = useTranslations("budget.texts");
  const { texts } = revision;
  const reviewed = new Set(revision.checks.filter((c) => c.done).map((c) => c.key));
  const saveBlocks = (blocks: Blocks) => onSave?.({ justification: { ...texts.justification, blocks } });
  const saveAnnex = (annex: Annex) => onSave?.({ annex });

  return (
    <div className="flex flex-col gap-4.5">
      <p className="max-w-[820px] text-sm text-muted-foreground">{t("intro")}</p>
      <div className="flex flex-col gap-4.5 lg:flex-row lg:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-4.5">
          <section className={cardVariants()} aria-labelledby="cover-title">
            <div className={cardHead}>
              <h2 id="cover-title">{t("cover")}</h2>
              <span className={muted}>{t("coverHint")}</span>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {COVER_FIELDS.map((key) => (
                <label key={key} className={cn("flex flex-col gap-1.5 text-[12.5px] font-semibold text-muted-foreground", LONG.has(key) && "md:col-span-2")}>
                  <span className="flex flex-wrap items-center gap-2">
                    {t(`coverFields.${key}`)}
                    {key === "cadastral" && !texts.cover.cadastral && <Badge variant="warn">{t("missing")}</Badge>}
                  </span>
                  <SaveOnBlur
                    key={key + texts.cover[key]}
                    label={t(`coverFields.${key}`)}
                    value={texts.cover[key]}
                    multiline={LONG.has(key)}
                    rows={2}
                    invalid={key === "cadastral" && !texts.cover.cadastral}
                    onSave={onSave ? (value) => onSave({ cover: { ...texts.cover, [key]: value } }) : undefined}
                  />
                </label>
              ))}
            </div>
          </section>

          <section className={cardVariants()} aria-labelledby="justification-title">
            <h2 id="justification-title">{t("justification")}</h2>
            <SaveOnBlur
              key={texts.justification.intro}
              label={t("justificationIntro")}
              multiline
              value={texts.justification.intro}
              onSave={onSave ? (intro) => onSave({ justification: { ...texts.justification, intro } }) : undefined}
            />
            {texts.justification.blocks.map((block, i) => (
              <div key={`${i}-${block.title}`} className="grid gap-2 border-t pt-3 md:grid-cols-[200px_minmax(0,1fr)_auto]">
                <SaveOnBlur label={t("blockTitle")} value={block.title} className="font-bold" onSave={onSave ? (title) => saveBlocks(replaceAt(texts.justification.blocks, i, { ...block, title })) : undefined} />
                <SaveOnBlur label={t("blockText", { title: block.title })} value={block.text} multiline rows={4} onSave={onSave ? (text) => saveBlocks(replaceAt(texts.justification.blocks, i, { ...block, text })) : undefined} />
                {onSave && (
                  <span className="flex gap-0.5 md:flex-col">
                    <Button type="button" variant="ghost" size="icon-sm" disabled={i === 0} aria-label={t("up", { title: block.title })} onClick={() => saveBlocks(moveItem(texts.justification.blocks, i, i - 1))}>
                      <ArrowUp aria-hidden />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" disabled={i === texts.justification.blocks.length - 1} aria-label={t("down", { title: block.title })} onClick={() => saveBlocks(moveItem(texts.justification.blocks, i, i + 1))}>
                      <ArrowDown aria-hidden />
                    </Button>
                    <Button type="button" variant="ghost" size="icon-sm" className="hover:text-bad" aria-label={t("remove", { title: block.title })} onClick={() => saveBlocks(removeAt(texts.justification.blocks, i))}>
                      <Trash2 aria-hidden />
                    </Button>
                  </span>
                )}
              </div>
            ))}
            {onSave && (
              <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => saveBlocks([...texts.justification.blocks, { title: t("newBlock"), text: "" }])}>
                + {t("addBlock")}
              </Button>
            )}
          </section>

          <section className={cardVariants()} aria-labelledby="criterion-title">
            <h2 id="criterion-title">{t("criterion")}</h2>
            <SaveOnBlur key={texts.measurementCriterion} label={t("criterion")} multiline rows={4} value={texts.measurementCriterion} onSave={onSave ? (measurementCriterion) => onSave({ measurementCriterion }) : undefined} />
            <p className={muted}>{t("criterionHint")}</p>
          </section>

          <section className={cardVariants()} aria-labelledby="annex-title">
            <div className={cardHead}>
              <h2 id="annex-title">{t("annex")}</h2>
              <span className={muted}>{t("annexHint")}</span>
            </div>
            {texts.annex.length === 0 && <p className={muted}>{t("annexNone")}</p>}
            {texts.annex.map((item, i) => (
              <div key={item.id} className="grid gap-2 border-t pt-3 md:grid-cols-[150px_200px_minmax(0,1fr)_auto]">
                <span className="flex flex-col gap-1.5">
                  {onSave ? (
                    <NativeSelect aria-label={t("annexKind")} value={item.kind} onChange={(event) => saveAnnex(replaceAt(texts.annex, i, { ...item, kind: event.target.value as Annex[number]["kind"] }))}>
                      {ANNEX_KINDS.map((kind) => (
                        <option key={kind} value={kind}>{t(`annexKinds.${kind}`)}</option>
                      ))}
                    </NativeSelect>
                  ) : (
                    <Badge variant="outline">{t(`annexKinds.${item.kind}`)}</Badge>
                  )}
                  {reviewed.has(checkKey.annex(item.id)) && <Badge variant="good">{t("reviewed")}</Badge>}
                </span>
                <SaveOnBlur label={t("annexTitle")} value={item.title} className="font-semibold" onSave={onSave ? (title) => saveAnnex(replaceAt(texts.annex, i, { ...item, title })) : undefined} />
                <SaveOnBlur label={t("annexText", { title: item.title })} value={item.text} multiline rows={3} onSave={onSave ? (text) => saveAnnex(replaceAt(texts.annex, i, { ...item, text })) : undefined} />
                {onSave && (
                  <Button type="button" variant="ghost" size="icon-sm" className="hover:text-bad" aria-label={t("remove", { title: item.title })} onClick={() => saveAnnex(removeAt(texts.annex, i))}>
                    <Trash2 aria-hidden />
                  </Button>
                )}
              </div>
            ))}
            {onSave && (
              <Button type="button" variant="ghost" size="sm" className="w-fit" onClick={() => saveAnnex([...texts.annex, { id: crypto.randomUUID().slice(0, 8), kind: "note", title: t("newAnnex"), text: "" }])}>
                + {t("addAnnex")}
              </Button>
            )}
          </section>
        </div>

        <aside className={cn(cardVariants(), "gap-1 lg:w-[300px] lg:flex-none")} aria-labelledby="inputs-title">
          <span id="inputs-title" className="eyebrow pb-1.5">{t("inputs")}</span>
          {inputs.length === 0 && <p className={muted}>{t("noInputs")}</p>}
          {inputs.map((doc) => (
            <a key={doc.id} href={fileUrl(doc)} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2.5 border-t py-2 text-[13.5px] hover:text-primary">
              <FileText size={18} className="flex-none text-muted-foreground" aria-hidden />
              <span className="min-w-0 flex-1">
                {t(`inputKinds.${doc.budgetInput!}`)} · <span className="text-muted-foreground">{doc.filename ?? doc.title}</span>
              </span>
            </a>
          ))}
        </aside>
      </div>
    </div>
  );
}
